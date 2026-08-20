/* Derives artifact.html from index.html.
   The Artifact host supplies its own <!doctype>, <head> and <body>, so the
   published file must be body content only. Everything else is byte-identical
   to the standalone game. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

const title = src.match(/<title>[\s\S]*?<\/title>/)[0];
const style = src.match(/<style>[\s\S]*?<\/style>/)[0];
const body = src.match(/<body>([\s\S]*)<\/body>/)[1];

const out = `${title}\n${style}\n${body.trim()}\n`;

if (/<!doctype|<html|<head|<\/body>/i.test(out)) throw new Error('wrapper tags leaked into artifact.html');
if (!/window\.__SI/.test(out)) throw new Error('game script missing from artifact.html');

fs.writeFileSync(path.join(dir, 'artifact.html'), out);
console.log('artifact.html written:', out.length, 'bytes');
