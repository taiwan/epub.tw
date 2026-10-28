/** Compare two static site directories. Never ignore content or asset changes. */
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
const [actual,expected]=process.argv.slice(2);
assert.ok(actual&&expected,'Usage: node tests/compare-site.mjs dist reference-dist');
const files=(root,folder=root)=>readdirSync(folder,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?files(root,path.join(folder,e.name)):[path.relative(root,path.join(folder,e.name))]).sort();
const a=files(actual),b=files(expected);
assert.deepEqual(a,b,'Generated route or asset filenames differ');
for(const file of b)assert.deepEqual(readFileSync(path.join(actual,file)),readFileSync(path.join(expected,file)),`Different output: ${file}`);
console.log(`PASS: all ${b.length} output files are byte-for-byte identical (HTML, CSS, SVG, images, XML, CNAME).`);
