// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '../types.js'
import { createBrowserSessionManager } from './browser-session.js'

export function createBrowserTools(_service?: any): ToolImplementation[] {
  // Create a shared browser session manager
  const browser = createBrowserSessionManager({
    maxSessionDurationMs: 300_000, // 5 minutes
    headless: true,
    screenshotDir: 'data/screenshots',
  })

  return [
    {
      name: 'browser_navigate',
      description:
        'Navigate to a URL in the browser. Returns page title and current URL. Use for research, web scraping, form filling.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['url'],
      },
      execute: async (input) => {
        try {
          return await browser.navigate(input.url as string)
        } catch (err: any) {
          return { error: err.message }
        }
      },
    },
    {
      name: 'browser_click',
      description:
        'Click an element on the current page by CSS selector.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector of element to click',
          },
        },
        required: ['selector'],
      },
      execute: async (input) => {
        try {
          return await browser.click(input.selector as string)
        } catch (err: any) {
          return { error: err.message }
        }
      },
    },
    {
      name: 'browser_fill',
      description: 'Fill an input field on the current page.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector of input element',
          },
          value: { type: 'string', description: 'Value to fill' },
        },
        required: ['selector', 'value'],
      },
      execute: async (input) => {
        try {
          return await browser.fill(
            input.selector as string,
            input.value as string,
          )
        } catch (err: any) {
          return { error: err.message }
        }
      },
    },
    {
      name: 'browser_screenshot',
      description:
        'Take a screenshot of the current page. Returns base64 PNG.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        try {
          return await browser.screenshot()
        } catch (err: any) {
          return { error: err.message }
        }
      },
    },
    {
      name: 'browser_get_content',
      description:
        'Get the text content of the current page (first 5000 chars).',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        try {
          return await browser.getContent()
        } catch (err: any) {
          return { error: err.message }
        }
      },
    },
    {
      name: 'browser_close',
      description: 'Close the browser session.',
      category: 'browser',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        await browser.close()
        return { closed: true }
      },
    },
  ]
}
