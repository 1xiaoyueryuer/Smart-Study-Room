export const visibilityLabels = {
  campus: '校园内匿名公开',
  private: '仅本人和管理员可见'
}

export const publicSummaryLimit = 300
export const publicDetailsLimit = 2000
export const publicComplaintCategories = {
  occupation: '预约与座位问题',
  facility_repair: '设施报修',
  other_service: '其他服务问题'
}

export function complaintVisibilityPayload(visibility, summary, details = '', photoIds = []) {
  if (!Object.hasOwn(visibilityLabels, visibility)) throw new Error('请选择可见范围。')
  if (visibility === 'private') return { visibility, public_summary: null, public_details: null, public_attachment_ids: [] }
  const publicSummary = summary.trim()
  if (!publicSummary || Array.from(publicSummary).length > publicSummaryLimit) {
    throw new Error(`请填写 1–${publicSummaryLimit} 字的公开摘要。`)
  }
  const publicDetails = details.trim()
  if (Array.from(publicDetails).length > publicDetailsLimit) {
    throw new Error(`公开详情最多 ${publicDetailsLimit} 字。`)
  }
  return { visibility, public_summary: publicSummary, public_details: publicDetails || null, public_attachment_ids: [...photoIds] }
}
