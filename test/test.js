const assert = require( 'assert' );
const rollup = require( 'rollup' );
const assign = require( 'object-assign' );
const typescript = require( '..' );

// Evaluate a bundle (as CommonJS) and return its exports.
async function evaluate ( bundle ) {
	const module = { exports: {} };
	new Function( 'module', 'exports', (await bundle.generate({ format: 'cjs' })).code )( module, module.exports );
	return module.exports;
}

// Short-hand for rollup using the typescript plugin.
async function bundle (main, options) {
	return await rollup.rollup({
		input: main,
		plugins: [typescript(options)]
	});
}

describe( 'rollup-plugin-typescript', () => {
	beforeEach(() => process.chdir(__dirname));

	it( 'runs code through typescript', async () => {
		const b = await bundle( 'sample/basic/main.ts' );
		const { code } = await b.generate({ format: 'es' });

		assert.ok( code.indexOf( 'number' ) === -1, code );
		assert.ok( code.indexOf( 'const' ) === -1, code );
	});

	it( 'ignores the declaration option', () => {
		return bundle( 'sample/basic/main.ts', { declaration: true });
	});

	it( 'handles async functions', async () => {
		const b = await bundle( 'sample/async/main.ts' );
		const wait = await evaluate(b);

		return wait(3);
	});

	it( 'does not duplicate helpers', async () => {
		const b = await bundle( 'sample/dedup-helpers/main.ts' );
		const { code } = await b.generate({ format: 'es' });

		// The `__extends` function is defined in the bundle.
		assert.ok( code.indexOf( 'function __extends' ) > -1, code );

		// No duplicate `__extends` helper is defined.
		assert.equal( code.indexOf( '__extends$1' ), -1, code );
	});

	it( 'transpiles `export class A` correctly', async () => {
		const b = await bundle( 'sample/export-class-fix/main.ts' );
		const { code } = await b.generate({ format: 'es' });

		assert.ok( code.indexOf( 'export { A, B };' ) !== -1, code );

		const { A, B } = await evaluate(b);
		const aInst = new A();
		const bInst = new B();
		assert.ok(aInst instanceof A);
		assert.ok(bInst instanceof B);


	});

	it( 'transpiles ES6 features to ES5 with source maps', async () => {
		const b = await bundle( 'sample/import-class/main.ts' );
		const { code } = await b.generate({ format: 'es' });

		assert.equal( code.indexOf( '...' ), -1, code );
		assert.equal( code.indexOf( '=>' ), -1, code );
	});

	it( 'reports diagnostics and throws if errors occur during transpilation', async () => {
		let errored;
		try {
			await bundle( 'sample/syntax-error/missing-type.ts' );
		} catch (err) {
			errored = true;
			assert.ok( err.message.indexOf( 'There were TypeScript errors transpiling' ) !== -1, 'Should reject erroneous code.' );
		}

		assert.ok(errored);
	});

	it( 'works with named exports for abstract classes', async () => {
		const b = await bundle( 'sample/export-abstract-class/main.ts' );
		const { code } = await b.generate({ format: 'es' });
		assert.ok( code.length > 0, code );
	});

	it( 'should use named exports for classes', async () => {
		const b = await bundle( 'sample/export-class/main.ts' );
		assert.equal( (await evaluate( b )).foo, 'bar' );
	});

	it( 'supports overriding the TypeScript version', async () => {
		const b = await bundle('sample/overriding-typescript/main.ts', {
			// Don't use `tsconfig.json`
			tsconfig: false,

			// test with a mocked version of TypeScript
			typescript: fakeTypescript({
				version: '1.8.0-fake',

				transpileModule: () => {
					// Ignore the code to transpile. Always return the same thing.
					return {
						outputText: 'export default 1337;',
						diagnostics: [],
						sourceMapText: JSON.stringify({ mappings: '' })
					};
				}
			})
		});

		assert.equal( await evaluate( b ), 1337 );
	});

	it( 'should not resolve .d.ts files', async () => {
		const b = await bundle( 'sample/dts/main.ts' );
		assert.deepEqual( b.imports, [ 'an-import' ] );
	});

	it( 'should transpile JSX if enabled', async () => {
		const b = await bundle( 'sample/jsx/main.tsx', { jsx: 'react' });
		const { code } = await b.generate({ format: 'es' });

		assert.notEqual( code.indexOf( 'var __assign = ' ), -1,
			'should contain __assign definition' );

		const usage = code.indexOf( 'React.createElement("span", __assign({}, props), "Yo!")' );

		assert.notEqual( usage, -1, 'should contain usage' );
	});

	it( 'automatically loads tsconfig.json from the current directory', async () => {
		process.chdir('sample/tsconfig-jsx');
		const b = await bundle( 'main.tsx');
		const { code } = await b.generate({ format: 'es' });

		const usage = code.indexOf( 'React.createElement("span", __assign({}, props), "Yo!")' );
		assert.notEqual( usage, -1, 'should contain usage' );
	});

	it('should throw on bad options', () => {
		return bundle('does-not-matter.ts', {
			foo: 'bar'
		}).then(() => {
			throw new Error('plugin did not throw');
		}).catch(err => assert.equal(err.message, 'rollup-plugin-typescript: Couldn\'t process compiler options'));
	});

	it( 'prevents errors due to conflicting `sourceMap`/`inlineSourceMap` options', () => {
		return bundle( 'sample/overriding-typescript/main.ts', {
			inlineSourceMap: true
		});
	});

	it ( 'should not fail if source maps are off', () => {
		return bundle( 'sample/overriding-typescript/main.ts', {
			inlineSourceMap: false,
			sourceMap: false
		});
	});

	it( 'does not include helpers in source maps', async () => {
		const b = await bundle( 'sample/dedup-helpers/main.ts', {
			sourceMap: true
		});

		const { map } = await b.generate({
			format: 'es',
			sourcemap: true
		});

		assert.ok( map.sources.every( source => source.indexOf( 'typescript-helpers' ) === -1) );
	});

	it( 'should allow a namespace containing a class', async () => {
		const b = await bundle( 'sample/export-namespace-export-class/test.ts');
		const MODE = (await evaluate(b)).MODE.MODE;
		const mode = new MODE();

		assert.ok(mode instanceof MODE);
	});

	it( 'should allow merging an exported function and namespace', async () => {
		const b = await bundle( 'sample/export-fodule/main.ts');
		const f = (await evaluate(b)).test;

		assert.equal(f(), 0);
		assert.equal(f.foo, "2");
	});
});

function fakeTypescript ( custom ) {
	return assign({
		transpileModule () {
			return {
				outputText: '',
				diagnostics: [],
				sourceMapText: JSON.stringify({ mappings: '' })
			};
		},

		convertCompilerOptionsFromJson ( options ) {
			[
				'include',
				'exclude',
				'typescript',
				'tslib',
				'tsconfig'
			].forEach( option => {
				if ( option in options ) {
					throw new Error( 'unrecognized compiler option "' + option + '"' );
				}
			});

			return {
				options,
				errors: []
			};
		}
	}, custom);
}
