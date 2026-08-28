import { describe, it, expect } from 'vitest'
import { analyzeComplexity } from '@modules/agent/complexity-analyzer'

describe('ComplexityAnalyzer', () => {
  describe('trivial — short questions', () => {
    it('classifies short question with "?" as trivial', () => {
      const result = analyzeComplexity({ userMessage: 'What is Odoo?' })
      expect(result.complexity).toBe('trivial')
      expect(result.suggestedMode).toBe('simple')
      expect(result.needsClarification).toBe(false)
    })

    it('classifies English question prefix as trivial', () => {
      const result = analyzeComplexity({ userMessage: 'How does the bus module work?' })
      expect(result.complexity).toBe('trivial')
      expect(result.suggestedMode).toBe('simple')
    })

    it('classifies Hungarian question prefix as trivial', () => {
      const result = analyzeComplexity({ userMessage: 'Mi az a Drizzle ORM?' })
      expect(result.complexity).toBe('trivial')
      expect(result.suggestedMode).toBe('simple')
    })

    it('classifies "is" prefix question as trivial', () => {
      const result = analyzeComplexity({ userMessage: 'Is the server running?' })
      expect(result.complexity).toBe('trivial')
      expect(result.suggestedMode).toBe('simple')
    })
  })

  describe('complex — multi-file development tasks', () => {
    it('detects module creation as complex', () => {
      const result = analyzeComplexity({ userMessage: 'Create a module for document management with a full pipeline system' })
      expect(result.complexity).toBe('complex')
      expect(result.suggestedMode).toBe('autonomous')
      expect(result.needsClarification).toBe(true)
      expect(result.clarificationQuestion).toBeTruthy()
    })

    it('detects Hungarian module building as complex', () => {
      const result = analyzeComplexity({ userMessage: 'Építs egy modult az ügyfélkezelő rendszerhez' })
      expect(result.complexity).toBe('complex')
      expect(result.suggestedMode).toBe('autonomous')
    })

    it('detects "implement a system" as complex', () => {
      const result = analyzeComplexity({ userMessage: 'Implement a notification system with email and webhook support' })
      expect(result.complexity).toBe('complex')
    })

    it('detects "refactor the workflow pipeline" as complex', () => {
      const result = analyzeComplexity({ userMessage: 'Refactor the workflow pipeline to support parallel stages' })
      expect(result.complexity).toBe('complex')
    })
  })

  describe('moderate — development but not multi-file', () => {
    it('classifies simple implementation task as moderate', () => {
      const result = analyzeComplexity({ userMessage: 'Implement a helper function for date formatting' })
      expect(result.complexity).toBe('moderate')
      expect(result.suggestedMode).toBe('managed')
      expect(result.needsClarification).toBe(false)
    })

    it('classifies "build a button component" as moderate', () => {
      const result = analyzeComplexity({ userMessage: 'Build a toggle button for dark mode' })
      expect(result.complexity).toBe('moderate')
      expect(result.suggestedMode).toBe('managed')
    })

    it('classifies "design the API response format" as moderate', () => {
      const result = analyzeComplexity({ userMessage: 'Design the API response format for errors' })
      expect(result.complexity).toBe('moderate')
    })
  })

  describe('simple — default fallthrough', () => {
    it('classifies generic statement as simple', () => {
      const result = analyzeComplexity({ userMessage: 'Show me the current configuration values' })
      expect(result.complexity).toBe('simple')
      expect(result.suggestedMode).toBe('simple')
      expect(result.needsClarification).toBe(false)
      expect(result.reasoning).toBe('Standard interaction')
    })

    it('classifies casual chat as simple', () => {
      const result = analyzeComplexity({ userMessage: 'Thanks, that looks good' })
      expect(result.complexity).toBe('simple')
    })
  })

  describe('edge cases', () => {
    it('handles empty message', () => {
      const result = analyzeComplexity({ userMessage: '' })
      expect(result.complexity).toBe('simple')
    })

    it('long question (>14 words) is not trivial even with "?"', () => {
      const result = analyzeComplexity({
        userMessage: 'How can I implement a custom authentication provider that supports multiple OAuth2 flows with token refresh and session management in the auth module?',
      })
      // 15+ words, has complex indicator => moderate or complex
      expect(result.complexity).not.toBe('trivial')
    })

    it('case insensitivity on indicators', () => {
      const result = analyzeComplexity({ userMessage: 'BUILD a new workflow MODULE for task tracking' })
      expect(result.complexity).toBe('complex')
    })
  })
})
