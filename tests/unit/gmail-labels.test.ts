import { describe, it, expect } from 'vitest';
import { ResponseParser } from '../../src/protocol/response-parser';
import type { UntaggedResponse } from '../../src/types/protocol';

describe('Gmail-specific label handling', () => {

  describe('Special Gmail folders', () => {
    it('should parse Gmail system labels correctly', () => {
      const responses: UntaggedResponse[] = [
        {
          type: 'LIST',
          data: {
            attributes: ['\\HasNoChildren'],
            delimiter: '/',
            name: '[Gmail]/All Mail'
          },
          raw: '* LIST (\\HasNoChildren) "/" "[Gmail]/All Mail"'
        },
        {
          type: 'LIST',
          data: {
            attributes: ['\\HasNoChildren'],
            delimiter: '/',
            name: '[Gmail]/Sent Mail'
          },
          raw: '* LIST (\\HasNoChildren) "/" "[Gmail]/Sent Mail"'
        }
      ];

      const tree = ResponseParser.parseListResponse(responses);

      expect(tree['[Gmail]']).toBeDefined();
      expect(tree['[Gmail]'].children).toBeDefined();
      expect(tree['[Gmail]'].children!['All Mail']).toBeDefined();
      expect(tree['[Gmail]'].children!['Sent Mail']).toBeDefined();
    });
  });

  describe('Custom labels', () => {
    it('should handle labels with spaces', () => {
      const responses: UntaggedResponse[] = [
        {
          type: 'LIST',
          data: {
            attributes: ['\\HasNoChildren'],
            delimiter: '/',
            name: 'My Custom Label'
          },
          raw: '* LIST (\\HasNoChildren) "/" "My Custom Label"'
        }
      ];

      const tree = ResponseParser.parseListResponse(responses);
      expect(tree['My Custom Label']).toBeDefined();
    });

    it('should handle nested labels', () => {
      const responses: UntaggedResponse[] = [
        {
          type: 'LIST',
          data: {
            attributes: ['\\HasChildren'],
            delimiter: '/',
            name: 'Projects'
          },
          raw: '* LIST (\\HasChildren) "/" "Projects"'
        },
        {
          type: 'LIST',
          data: {
            attributes: ['\\HasNoChildren'],
            delimiter: '/',
            name: 'Projects/2024'
          },
          raw: '* LIST (\\HasNoChildren) "/" "Projects/2024"'
        }
      ];

      const tree = ResponseParser.parseListResponse(responses);

      expect(tree['Projects']).toBeDefined();
      expect(tree['Projects'].children).toBeDefined();
      expect(tree['Projects'].children!['2024']).toBeDefined();
    });

    it('should handle labels with special characters', () => {
      const responses: UntaggedResponse[] = [
        {
          type: 'LIST',
          data: {
            attributes: [],
            delimiter: '/',
            name: 'Invoices & Receipts'
          },
          raw: '* LIST () "/" "Invoices & Receipts"'
        }
      ];

      const tree = ResponseParser.parseListResponse(responses);
      expect(tree['Invoices & Receipts']).toBeDefined();
    });
  });
});
