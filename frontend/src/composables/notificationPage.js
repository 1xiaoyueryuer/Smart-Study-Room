import {validRecordPage} from './recordPage.js'
import {formatCampusDateTime} from './campusDateTime.js'
const positive=value=>Number.isSafeInteger(value)&&value>0
const noticeTimeTypes = new Set(['restriction_started', 'complaint_feedback', 'complaint_service_progress', 'reservation_corrected_checkin'])
const isoNoticeTime = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?\b/g
export function validNotificationCounts(counts){if(!Number.isSafeInteger(counts?.total)||counts.total<0||!Number.isSafeInteger(counts.unread)||counts.unread<0||counts.unread>counts.total||!counts.by_type||typeof counts.by_type!=='object'||Array.isArray(counts.by_type))return false;const values=Object.values(counts.by_type);return values.every(value=>Number.isSafeInteger(value)&&value>=0)&&values.reduce((sum,n)=>sum+n,0)===counts.total}
export function validNotificationPage(data,query){return validRecordPage(data,query)&&validNotificationCounts(data.counts)&&data.items.every(item=>typeof item.type==='string'&&typeof item.is_read==='boolean'&&typeof item.title==='string'&&typeof item.content==='string')}
export function validReadReceipt(value,id){return Number.isSafeInteger(value?.marked)&&value.marked>=0&&Number.isSafeInteger(value.unread_count)&&value.unread_count>=0&&(id===null||value.id===id&&value.marked<=1)}
export function notificationContent(item){
 let content=typeof item?.content==='string'?item.content:''
 if(!noticeTimeTypes.has(item?.type))return content
 if(item.type==='complaint_feedback'){
  content=content.replace(/^请查看处理结果及依据，确认截止为(.+)；截止前可确认或提出异议。$/u,'请查看处理结果，并在截止前确认或提出异议。\n确认截止：$1')
 }
 if(item.type==='reservation_corrected_checkin'){
  content=content.replace(/^预约#\d+已补签。公开依据：([\s\S]+)。业务签到：([^；]+)；实际操作：[^。]+。这是管理员核实自报记录。$/u,
   '你的预约已补签。\n签到时间：$2\n补签说明：$1')
 }
 return content.replace(isoNoticeTime,value=>{
  const normalized=value.replace(/([+-]\d{2})$/,'$1:00').replace(/([+-]\d{2})(\d{2})$/,'$1:$2')
  const formatted=formatCampusDateTime(normalized)
  return formatted==='—'?value:formatted
 })
}
export function restrictionNoticeOf(item){
 if(item?.type!=='restriction_started'||typeof item.content!=='string')return null
 const lines=item.content.replace(/\r\n?/g,'\n').split('\n')
 const reasonLabelIndex=lines.findIndex(line=>line.trim()==='公开原因：')
 const deadlineIndex=lines.findIndex((line,index)=>index>reasonLabelIndex&&line.trim().startsWith('原定截止：'))
 if(reasonLabelIndex<0||deadlineIndex<=reasonLabelIndex+1)return null
 const reason=lines.slice(reasonLabelIndex+1,deadlineIndex).join('\n').trim()
 const rawDeadline=lines[deadlineIndex].trim().slice('原定截止：'.length).trim()
 const deadline=formatCampusDateTime(rawDeadline)
 const effectsLine=lines.slice(deadlineIndex+1).map(line=>line.trim()).find(Boolean)
 const effects=effectsLine?.match(/^当前已取消仍有效待签到预约(\d+)条，使用中预约可继续至原定结束。$/)
 if(!reason||deadline==='—'||!effects)return null
 const cancelledPendingCount=Number(effects[1])
 if(!Number.isSafeInteger(cancelledPendingCount))return null
 return{reason,deadline,cancelledPendingCount}
}
export function reservationTarget(item){return ['reservation_success','reservation_cancelled','reservation_checkin','reservation_completed','management_cancelled','reservation_corrected_checkin','restriction_cancelled'].includes(item?.type)&&positive(item.reservation_id)?{path:'/mine',query:{reservation_id:String(item.reservation_id)}}:null}
export function appealTarget(item){return item?.type==='appeal_reviewed'&&positive(item.appeal_id)?`/appeals/${item.appeal_id}`:null}
export function restrictionTarget(item){return ['restriction_started','restriction_released','restriction_cancelled'].includes(item?.type)&&positive(item.restriction_id)?{path:'/profile',query:{restriction_id:item.restriction_id},hash:'#restrictions'}:null}
export function violationTarget(item){return item?.type==='violation'&&positive(item.violation_id)?{path:'/profile',query:{violation_id:item.violation_id},hash:'#violations'}:null}
export function complaintTarget(item){return ['complaint_feedback','complaint_auto_closed','complaint_priority_assessed','complaint_initial_arrangement','complaint_service_progress'].includes(item?.type)&&positive(item.complaint_id)?`/complaints/${item.complaint_id}`:null}
export function adminWorkTarget(item) {
 if (['admin_complaint_urgent','admin_complaint_returned'].includes(item?.type) && positive(item.complaint_id)) {
  return {path:'/admin',query:{complaint_id:String(item.complaint_id)}}
 }
 if (item?.type==='admin_appeal_submitted' && positive(item.appeal_id)) {
  return {path:'/admin',query:{appeal_id:String(item.appeal_id)}}
 }
 return null
}
export function hasNotificationTarget(item,reviewTarget){return !!(reservationTarget(item)||appealTarget(item)||restrictionTarget(item)||violationTarget(item)||complaintTarget(item)||adminWorkTarget(item)||reviewTarget(item))}
