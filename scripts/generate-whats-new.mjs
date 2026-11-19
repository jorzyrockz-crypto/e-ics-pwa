import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

function gitLog(range) {
  try {
    return execFileSync('git', ['log', '--no-merges', '--format=%s', ...range], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const base = process.env.WHATS_NEW_BASE_SHA;
let subjects = base && !/^0+$/.test(base)
  ? gitLog([`${base}..HEAD`])
  : [];
if (!subjects.length) subjects = gitLog(['-n', '5', 'HEAD']);

const skip = /^(merge |bump |release\b|version\b|chore\(release\))/i;
const notes = [...new Set(subjects.filter(s => !skip.test(s)))].slice(0, 5).reverse().map(subject => {
  let text = subject.replace(/^(feat|fix|docs|refactor|perf|chore|test|build)(\([^)]*\))?:\s*/i, '');
  text = text.replace(/^add\b/i, 'Added').replace(/^fix\b/i, 'Fixed').replace(/^improve\b/i, 'Improved').replace(/^update\b/i, 'Updated').replace(/^expand\b/i, 'Expanded');
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
});

let version = 'local';
try { version = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const payload = { version, notes: notes.length ? notes : ['General improvements and fixes.'] };
mkdirSync('public', { recursive: true });
writeFileSync('public/whats-new.json', `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Generated What's New (${version}): ${payload.notes.length} note(s).`);
