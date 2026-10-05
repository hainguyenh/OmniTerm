import { describe, expect, it } from 'vitest'

import { handleCsvRequest, parseRow, readRow, scanRows, sniffDelimiter } from '../csvParse'
import { colRange, prefixSums, rowRange } from '../virtualWindow'

const rows = (text: string, delimiter = ',', maxRows?: number) => {
  const scan = scanRows(text, delimiter, maxRows)
  return Array.from({ length: scan.rowCount }, (_, row) => readRow(text, scan, row))
}

describe('sniffDelimiter', () => {
  it('prefers the consistent delimiter and always uses tab for .tsv', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3', 'x.csv')).toBe(';')
    expect(sniffDelimiter('a,b\n1,2', 'x.csv')).toBe(',')
    expect(sniffDelimiter('a|b|c\n1|2|3', 'x.csv')).toBe('|')
    expect(sniffDelimiter('a\tb\n1\t2', 'x.csv')).toBe('\t')
    expect(sniffDelimiter('a,b', 'x.tsv')).toBe('\t')
    expect(sniffDelimiter('', 'x.csv')).toBe(',')
    expect(sniffDelimiter('plain\ntext', 'x.csv')).toBe(',')
  })
})

describe('scanRows', () => {
  it('splits rows on LF, CRLF and CR and ignores a trailing newline', () => {
    expect(rows('a,b\r\nc,d\ne,f\rg,h\n')).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']])
    expect(rows('')).toEqual([])
    expect(rows('only')).toEqual([['only']])
  })

  it('keeps delimiters, newlines and escaped quotes inside quoted fields', () => {
    expect(rows('"a,1","line\nbreak","say ""hi"""\nx,y')).toEqual([
      ['a,1', 'line\nbreak', 'say "hi"'],
      ['x', 'y'],
    ])
    // A quote in the middle of a field is literal.
    expect(rows('ab"c,d')).toEqual([['ab"c', 'd']])
  })

  it('recovers from a quote that never closes by reading the rest literally', () => {
    const text = 'h1,h2\n"open,x\nnext,row\n'
    const scan = scanRows(text, ',')
    expect(scan.literalFrom).toBe(1)
    expect(Array.from({ length: scan.rowCount }, (_, row) => readRow(text, scan, row))).toEqual([
      ['h1', 'h2'], ['"open', 'x'], ['next', 'row'],
    ])
  })

  it('caps the indexed rows and sizes columns from a sample', () => {
    const text = Array.from({ length: 10 }, (_, index) => `${index},${'v'.repeat(index * 10)}`).join('\n')
    const scan = scanRows(text, ',', 4)
    expect(scan.truncated).toBe(true)
    expect(scan.rowCount).toBe(4)
    expect(readRow(text, scan, 3)).toEqual(['3', 'v'.repeat(30)])
    expect(scan.maxColumns).toBe(2)
    expect(scan.columnWidths[0]).toBe(48)
    expect(scanRows('a,b\n', ',', 1).truncated).toBe(false)
  })

  it('parses a row with quotes disabled', () => {
    expect(parseRow('"a","b"\r\n', 0, 9, ',', false)).toEqual(['"a"', '"b"'])
  })

  it('validates worker requests and transfers the row index', () => {
    const { result, transfer } = handleCsvRequest({ text: 'a\tb', fileName: 'x.tsv' })
    expect(result.delimiter).toBe('\t')
    expect(transfer).toEqual([result.rowStarts.buffer])
    expect(() => handleCsvRequest(null)).toThrow('Malformed')
    expect(() => handleCsvRequest({ text: 1, fileName: 'x' })).toThrow('Malformed')
  })
})

describe('virtualWindow', () => {
  it('computes visible row ranges with overscan', () => {
    expect(rowRange(0, 100, 20, 1000, 2)).toEqual([0, 7])
    expect(rowRange(400, 100, 20, 1000, 2)).toEqual([18, 27])
    expect(rowRange(-50, 100, 20, 3, 2)).toEqual([0, 3])
    expect(rowRange(0, 100, 20, 0)).toEqual([0, 0])
  })

  it('computes visible column ranges over variable widths', () => {
    const prefix = prefixSums([100, 50, 200, 80])
    expect(prefix).toEqual([0, 100, 150, 350, 430])
    expect(colRange(prefix, 0, 120, 0)).toEqual([0, 2])
    expect(colRange(prefix, 160, 100, 0)).toEqual([2, 3])
    expect(colRange(prefix, 400, 1000, 1)).toEqual([2, 4])
    expect(colRange([0], 0, 100)).toEqual([0, 0])
  })
})
