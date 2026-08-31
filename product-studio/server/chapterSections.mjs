const CHAPTER_HEADING_PATTERN = /^[ \t]*(第[零〇一二三四五六七八九十百千万两\d]+[章节卷回部篇]|Chapter[ \t]+\d+)[ \t]*[^\n]*$/gimu;

export function splitChapters(text) {
  const source = String(text || '');
  const matches = [...source.matchAll(CHAPTER_HEADING_PATTERN)];
  if (!matches.length) return source ? [{ index: 1, title: '全文', start: 0, end: source.length }] : [];
  const boundaries = matches[0].index > 0 ? [{ start: 0, title: '序章' }] : [];
  boundaries.push(...matches.map(match => ({ start: match.index, title: match[0].trim() })));
  return boundaries.map((item, index) => ({
    index: index + 1,
    title: item.title,
    start: item.start,
    end: boundaries[index + 1]?.start ?? source.length,
  }));
}

export function numberedChapterTitle(index) {
  return `第 ${Math.max(1, Math.round(Number(index) || 1))} 章`;
}

function chapterIndexAt(chapters, position) {
  const safePosition = Math.max(0, Number(position) || 0);
  const chapter = chapters.find(item => safePosition >= item.start && safePosition < item.end)
    || chapters.at(-1);
  return chapter?.index || 1;
}

export function assignNumberedChapterSections(sourceText, chapters, segmentRows) {
  const source = String(sourceText || '');
  const boundaries = Array.isArray(chapters) && chapters.length ? chapters : splitChapters(source);
  let cursor = 0;
  return (Array.isArray(segmentRows) ? segmentRows : []).map(row => {
    if (!Array.isArray(row)) return row;
    const updated = [...row];
    const segmentSource = String(updated[5] || '');
    const located = segmentSource ? source.indexOf(segmentSource, cursor) : -1;
    const position = located >= 0 ? located : Math.min(cursor, Math.max(0, source.length - 1));
    updated[1] = numberedChapterTitle(chapterIndexAt(boundaries, position));
    cursor = located >= 0 ? located + segmentSource.length : Math.min(source.length, cursor + segmentSource.length);
    return updated;
  });
}
