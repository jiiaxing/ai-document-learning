import * as assert from 'assert';
import { extractResponseText, getValueByPath, resolveResponseTextPath } from '../core/openaiResponseUtils';

suite('Provider Utils Suite', () => {
    test('resolveResponseTextPath adapts anthropic default path', () => {
        assert.strictEqual(resolveResponseTextPath('anthropic', ''), 'content.0.text');
        assert.strictEqual(resolveResponseTextPath('anthropic', 'choices.0.message.content'), 'content.0.text');
    });

    test('resolveResponseTextPath keeps explicit path', () => {
        assert.strictEqual(resolveResponseTextPath('openai', 'choices.0.message.content'), 'choices.0.message.content');
        assert.strictEqual(resolveResponseTextPath('anthropic', 'content.1.text'), 'content.1.text');
    });

    test('getValueByPath supports object and array segments', () => {
        const data = {
            choices: [
                { message: { content: 'hello openai' } }
            ],
            content: [
                { text: 'hello anthropic' }
            ]
        };

        assert.strictEqual(getValueByPath(data, 'choices.0.message.content'), 'hello openai');
        assert.strictEqual(getValueByPath(data, 'content.0.text'), 'hello anthropic');
    });

    test('extractResponseText returns normalized string', () => {
        const data = {
            choices: [
                { message: { content: '  hello world  ' } }
            ]
        };

        assert.strictEqual(extractResponseText(data, 'choices.0.message.content'), 'hello world');
    });
});
