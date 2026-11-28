export const visibilityLabels = {
  campus: '校园内匿名公开',
  private: '仅本人和管理员可见'
}

export const publicSummaryLimit = 300

export function complaintVisibilityPayload(visibility, summary) {
  if (!Object.hasOwn(visibilityLabels, visibility)) throw new Error('请选择可见范围。')
  if (visibility === 'private') return { visibility, public_summary: null }
  const publicSummary = summary.trim()
  if (!publicSummary || Array.from(publicSummary).length > publicSummaryLimit) {
    throw new Error(`请填写 1–${publicSummaryLimit} 字的公开摘要。`)
  }
  return { visibility, public_summary: publicSummary }
}
