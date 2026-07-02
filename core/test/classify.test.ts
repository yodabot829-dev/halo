import { describe, expect, it } from 'vitest'
import { classify, type ChatMessage } from '../src/router/classify.js'

const user = (content: string): ChatMessage => ({ role: 'user', content })

describe('classify', () => {
  it('detects vision when an image is present', () => {
    expect(classify([user('what is this?')], true)).toBe('vision')
  })

  it('detects summarise requests', () => {
    expect(classify([user('Summarise this article for me')])).toBe('summarise')
    expect(classify([user('give me the TL;DR')])).toBe('summarise')
  })

  it('detects code tasks', () => {
    expect(classify([user('Fix this function ```js\nconst x = 1\n```')])).toBe('code')
    expect(classify([user('debug the TypeScript build error')])).toBe('code')
  })

  it('detects reasoning tasks by keyword', () => {
    expect(classify([user('Compare these two architectures and evaluate trade-offs')])).toBe(
      'reason',
    )
  })

  it('detects reasoning tasks by length', () => {
    expect(classify([user('x'.repeat(2001))])).toBe('reason')
  })

  it('defaults to chat', () => {
    expect(classify([user('morning, how are we doing today')])).toBe('chat')
  })

  it('classifies on the LAST user message', () => {
    const messages: ChatMessage[] = [
      user('summarise this'),
      { role: 'assistant', content: 'done' },
      user('thanks, hello there'),
    ]
    expect(classify(messages)).toBe('chat')
  })
})
