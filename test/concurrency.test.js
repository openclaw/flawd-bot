import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Evaluator, Lexer, Parser, data } from '@actions/expressions';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/clawsweeper-dispatch.yml', import.meta.url), 'utf8'));

function dictionary(value) {
  if (typeof value === 'number') return new data.NumberData(value);
  if (typeof value === 'string') return new data.StringData(value);
  return new data.Dictionary(...Object.entries(value).map(([key, value]) => ({ key, value: dictionary(value) })));
}

function evaluate(source, github) {
  const tokens = new Lexer(source).lex().tokens;
  const expression = new Parser(tokens, ['github'], []).parse();
  return new Evaluator(expression, dictionary({ github })).evaluate();
}

function context(event_name, action, { item = 3, comment = 100, actor = 'contributor', run = 10 } = {}) {
  const event = { action };
  if (event_name === 'pull_request_target') event.pull_request = { number: item };
  if (event_name === 'issues' || event_name === 'issue_comment') event.issue = { number: item };
  if (event_name === 'issue_comment') event.comment = { id: comment };
  return { repository: 'example/flawd-bot', event_name, event, actor, run_id: run };
}

function group(github) {
  return workflow.concurrency.group.replace(/\$\{\{(.*?)\}\}/g, (_, expression) => evaluate(expression, github).coerceString()).toLowerCase();
}

function cancels(github) {
  return evaluate(workflow.concurrency['cancel-in-progress'].slice(3, -2), github).value;
}

test('item updates cannot cancel command comments on the same item', () => {
  const command = context('issue_comment', 'created');
  for (const event of ['issues', 'pull_request_target']) {
    for (const action of ['edited', 'synchronize', 'ready_for_review']) {
      const update = context(event, action);
      assert.equal(cancels(update), true);
      assert.notEqual(group(command), group(update), `${event}/${action}`);
    }
  }
});

test('distinct commands stay independent, while editing a command supersedes itself', () => {
  const command = context('issue_comment', 'created');
  const edit = context('issue_comment', 'edited');
  assert.notEqual(group(command), group(context('issue_comment', 'created', { comment: 101 })));
  assert.equal(group(command), group(edit));
  assert.equal(cancels(command), false);
  assert.equal(cancels(edit), true);
});

test('new revisions still supersede earlier item updates', () => {
  for (const event of ['issues', 'pull_request_target']) {
    const first = context(event, 'opened');
    assert.equal(group(first), group(context(event, 'edited', { run: 11 })));
    assert.notEqual(group(first), group(context(event, 'edited', { item: 4 })));
  }
  const initial = context('pull_request_target', 'opened');
  for (const action of ['synchronize', 'ready_for_review']) {
    const next = context('pull_request_target', action);
    assert.equal(group(initial), group(next));
    assert.equal(cancels(next), true);
  }
});

test('skipped bot label events cannot displace pending human dispatches', () => {
  for (const event of ['issues', 'pull_request_target']) {
    for (const action of ['labeled', 'unlabeled']) {
      const bot = context(event, action, { actor: 'automation[bot]' });
      assert.notEqual(group(bot), group(context(event, action)));
      assert.notEqual(group(bot), group(context('issue_comment', 'created')));
      assert.equal(cancels(bot), false);
    }
    assert.equal(group(context(event, 'edited', { actor: 'automation[bot]' })), group(context(event, 'edited')));
  }
});

test('issue and pull request event types do not collide', () => {
  assert.notEqual(group(context('issues', 'edited')), group(context('pull_request_target', 'edited')));
});

test('events without an item fall back to their run id', () => {
  assert.notEqual(group(context('workflow_dispatch', '', { run: 10 })), group(context('workflow_dispatch', '', { run: 11 })));
});
