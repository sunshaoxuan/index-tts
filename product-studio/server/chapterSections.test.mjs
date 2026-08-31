import assert from 'node:assert/strict';
import test from 'node:test';

import { assignNumberedChapterSections, numberedChapterTitle, splitChapters } from './chapterSections.mjs';

const row = (order, section, source) => [order, section, 'narrator', '旁白', 'ZH', source, source];

test('collapses free-form per-sentence sections into one numbered chapter without headings', () => {
  const source = '第一句。第二句。第三句。';
  const rows = [
    row(1, '第一句。', '第一句。'),
    row(2, '另一个完整台词被误当成章节', '第二句。'),
    row(3, '每句一章', '第三句。'),
  ];

  const assigned = assignNumberedChapterSections(source, splitChapters(source), rows);

  assert.deepEqual(assigned.map(item => item[1]), ['第 1 章', '第 1 章', '第 1 章']);
  assert.deepEqual(assigned.map(item => item.slice(2)), rows.map(item => item.slice(2)));
});

test('assigns segments to formal source headings and presents compact continuous numbers', () => {
  const source = '第一章 雨夜\n甲。\n第二章 天明\n乙。';
  const chapters = splitChapters(source);
  const assigned = assignNumberedChapterSections(source, chapters, [
    row(1, '长标题甲', '甲。'),
    row(2, '长标题乙', '乙。'),
  ]);

  assert.deepEqual(chapters.map(item => item.title), ['第一章 雨夜', '第二章 天明']);
  assert.deepEqual(assigned.map(item => item[1]), ['第 1 章', '第 2 章']);
});

test('numbers preface content and later formal headings as distinct source-traceable chapters', () => {
  const source = '序言。\n第一章\n正文。';
  const assigned = assignNumberedChapterSections(source, splitChapters(source), [
    row(1, '序言', '序言。'),
    row(2, '正文', '正文。'),
  ]);

  assert.deepEqual(assigned.map(item => item[1]), ['第 1 章', '第 2 章']);
});

test('keeps failed source lookup fallback ordered and stable', () => {
  const source = '第一章\n甲。\n第二章\n乙。';
  const rows = [row(1, '旧章节', '不在原文中'), row(2, '旧章节', '乙。')];
  assert.deepEqual(
    assignNumberedChapterSections(source, splitChapters(source), rows).map(item => item[1]),
    ['第 1 章', '第 2 章'],
  );
  assert.equal(numberedChapterTitle(0), '第 1 章');
});
