import assert from 'node:assert/strict';
import test from 'node:test';
import { SelectionTriggerGate, normalizeSelectionText } from '../standalone/selectionGate';

test('selection gate normalizes PDF text layer whitespace', () => {
    assert.equal(normalizeSelectionText('  virtual\nmemory\t system  '), 'virtual memory system');
});

test('selection gate rejects short, duplicate, and cooldown triggers', () => {
    const gate = new SelectionTriggerGate({ minLength: 6, cooldownMs: 700 });

    assert.equal(gate.evaluate('abc', 1000).reason, 'too-short');

    const first = gate.evaluate('cache coherence protocol', 1000);
    assert.equal(first.shouldTrigger, true);
    gate.markTriggered(first.normalizedText, 1000);

    const duplicate = gate.evaluate('cache   coherence protocol', 1200);
    assert.equal(duplicate.reason, 'duplicate');

    const cooldown = gate.evaluate('memory consistency model', 1300);
    assert.equal(cooldown.reason, 'cooldown');

    const later = gate.evaluate('memory consistency model', 1800);
    assert.equal(later.shouldTrigger, true);
});

