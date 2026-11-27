import {validRecordPage} from './recordPage.js'
import {formatCampusDateTime} from './campusDateTime.js'
const positive=value=>Number.isSafeInteger(value)&&value>0
export function validNotificationCounts(counts){if(!Number.isSafeInteger(counts?.total)||counts.total<0||!Number.isSafeInteger(counts.unread)||counts.unread<0||counts.unread>counts.total||!counts.by_type||typeof counts.by_type!=='object'||Array.isArray(counts.by_type))return false;const values=Object.values(counts.by_type);return values.every(value=>Number.isSafeInteger(value)&&value>=0)&&values.reduce((sum,n)=>sum+n,0)===counts.total}
export function validNotificationPage(data,query){return validRecordPage(data,query)&&validNotificationCounts(data.counts)&&data.items.every(item=>typeof item.type==='string'&&typeof item.is_read==='boolean'&&typeof item.title==='string'&&typeof item.content==='string')}
export function validReadReceipt(value,id){return Number.isSafeInteger(value?.marked)&&value.marked>=0&&Number.isSafeInteger(value.unread_count)&&value.unread_count>=0&&(id===null||value.id===id&&value.marked<=1)}
export function notificationContent(item){
 const content=typeof item?.content==='string'?item.content:''
 if(item?.type!=='restriction_started')return content
 return content.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?\b/g,value=>{
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
export function hasNotificationTarget(item,reviewTarget){return !!(reservationTarget(item)||appealTarget(item)||restrictionTarget(item)||violationTarget(item)||complaintTarget(item)||reviewTarget(item))}
