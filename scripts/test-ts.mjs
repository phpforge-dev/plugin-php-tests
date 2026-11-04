// Testes TypeScript sem dependências extras: o esbuild empacota cada teste e o node:test executa.
import {build} from 'esbuild';
import {readdir, mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const tests=(await readdir('tests')).filter(f=>f.endsWith('.test.ts'));
const out=await mkdtemp(join(tmpdir(),'php-tests-ts-'));
try{
 await build({entryPoints:tests.map(f=>join('tests',f)),outdir:out,bundle:true,format:'esm',platform:'node',target:'node22',outExtension:{'.js':'.mjs'},logLevel:'warning'});
 const result=spawnSync(process.execPath,['--test',...tests.map(f=>join(out,f.replace(/\.ts$/,'.mjs')))],{stdio:'inherit',env:{...process.env,PHP_TESTS_FIXTURES:join(process.cwd(),'tests/fixtures')}});
 process.exitCode=result.status??1;
}finally{await rm(out,{recursive:true,force:true});}
