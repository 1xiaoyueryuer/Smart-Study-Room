<script setup>
import { ref,nextTick,onMounted } from 'vue'
import {getOverview} from '../../api/stats'
import {validOverview} from '../../composables/statsForm.js'
import AdminAudit from '../../components/admin/AdminAudit.vue'
import AdminRecords from '../../components/admin/AdminRecords.vue'
import ReviewManagement from '../../components/admin/ReviewManagement.vue'
import CheckinCorrection from '../../components/admin/CheckinCorrection.vue'
import AppealManagement from '../../components/admin/AppealManagement.vue'
import RestrictionManagement from '../../components/admin/RestrictionManagement.vue'
import ComplaintManagement from '../../components/admin/ComplaintManagement.vue'
import UserManagement from '../../components/admin/UserManagement.vue'
import ResourceManagement from '../../components/admin/ResourceManagement.vue'
import AppIcon from '../../components/AppIcon.vue'
import SButton from '../../components/ui/SButton.vue'
const audit=ref(null),auditMounted=ref(false)
const recordsMounted=ref(false),violationsMounted=ref(false),correction=ref(null)
const reviews=ref(null),reviewsMounted=ref(false)
const correctionMounted=ref(false),correctionOpen=ref(false)
const activeTab = ref('rooms')
const resources = ref(null), users = ref(null), complaints = ref(null), complaintsMounted = ref(false), restrictions = ref(null), restrictionsMounted = ref(false), appeals=ref(null), appealsMounted=ref(false)
const groups=[
  {key:'ops',label:'运营',items:[
    {key:'rooms',label:'自习室管理',icon:'building'},
    {key:'records',label:'预约与使用记录',icon:'reservations'},
    {key:'users',label:'用户管理',icon:'users'}
  ]},
  {key:'service',label:'服务',items:[
    {key:'complaints',label:'投诉与报修',icon:'ticket'},
    {key:'reviews',label:'评价管理',icon:'ticket'}
  ]},
  {key:'discipline',label:'纪律',items:[
    {key:'violations',label:'违规记录',icon:'warning'},
    {key:'restrictions',label:'预约限制',icon:'warning'},
    {key:'appeals',label:'申诉待办',icon:'ticket'}
  ]},
  {key:'compliance',label:'合规',items:[
    {key:'audit',label:'审计查询',icon:'ticket'}
  ]}
]
function selectTab(key) {
  activeTab.value=key
  if(key==='records') correctionOpen.value=false
  if(key==='audit') auditMounted.value=true
  if(key==='records') recordsMounted.value=true
  if(key==='violations') violationsMounted.value=true
  if(key==='reviews') reviewsMounted.value=true
  if(key==='complaints') complaintsMounted.value=true
  if(key==='restrictions') restrictionsMounted.value=true
  if(key==='appeals') appealsMounted.value=true
}
async function openCorrection(id){
  activeTab.value='records';recordsMounted.value=true;correctionMounted.value=true;correctionOpen.value=true
  await nextTick();await correction.value?.openReservation(id)
}
function closeCorrection(){correctionOpen.value=false}
const roomStats = ref(null), userStats = ref(null)
const overview=ref(null),overviewError=ref('')
async function loadOverview(){try{const {data}=await getOverview();if(validOverview(data))overview.value=data;overviewError.value=''}catch(e){overviewError.value=e.message||'统计读取失败'}}
onMounted(loadOverview)
</script>
<template>
  <div v-reveal class="page-view">
    <header class="view-heading"><div class="heading-copy" data-page-title><h1>管理端</h1><p class="heading-sub">运营、服务、纪律与合规管理</p></div></header>
    <section class="admin-kpis" aria-label="今日概览">
      <div class="admin-kpi"><span>今日预约</span><b>{{ overview?.day.created_count ?? '—' }}</b><small>成功创建</small></div>
      <div class="admin-kpi"><span>当前使用中</span><b>{{ overview?.current.in_use_now ?? '—' }}</b><small>开放可用 {{ overview?.current.open_available_seats ?? '—' }}</small></div>
      <div class="admin-kpi"><span>待处理工单</span><b>{{ overview?.current.complaint_todo_count ?? '—' }}</b><small>待确认 {{ overview?.current.complaint_awaiting_count ?? '—' }}</small></div>
      <div class="admin-kpi"><span>自习室总数</span><b>{{ roomStats?.total ?? '—' }}</b><small>实际座位 {{ roomStats?.seats ?? '—' }}</small></div>
    </section>
    <p v-if="overviewError" class="muted">统计读取失败：{{ overviewError }}；下方管理功能仍可正常使用。</p>
    <section class="card admin-stats">
      <div class="card-title-row"><h3>资源与账号</h3></div>
      <div class="kpi-grid"><div class="kpi"><div class="kpi-num">{{ roomStats?.total ?? '—' }}</div><div class="kpi-label">空间数量</div></div><div class="kpi"><div class="kpi-num">{{ roomStats?.seats ?? '—' }}</div><div class="kpi-label">实际座位数量</div></div><div class="kpi"><div class="kpi-num">{{ roomStats?.capacity ?? '—' }}</div><div class="kpi-label">启用空间有效容量</div></div><div class="kpi"><div class="kpi-num">{{ userStats?.total ?? '—' }}</div><div class="kpi-label">校园账号</div></div></div>
    </section>
    <div class="admin-layout">
      <aside class="card admin-sidebar">
        <div class="card-title-row"><h3>管理面板</h3></div>
        <nav class="side-nav admin-nav" aria-label="管理功能分组">
          <template v-for="group in groups" :key="group.key">
            <div class="admin-nav-group-title">{{ group.label }}</div>
            <button v-for="tab in group.items" :key="tab.key" class="side-nav-item" :class="{active:activeTab===tab.key}" @click="selectTab(tab.key)"><span class="side-nav-icon"><AppIcon :name="tab.icon" :size="17" /></span><span class="side-nav-label">{{ tab.label }}</span></button>
          </template>
        </nav>
      </aside>
      <div class="admin-content">
        <AdminAudit v-if="auditMounted" v-show="activeTab==='audit'" ref="audit"/>
        <AdminRecords v-if="recordsMounted" v-show="activeTab==='records' && !correctionOpen" kind="reservation" @correct="openCorrection"/>
        <AdminRecords v-if="violationsMounted" v-show="activeTab==='violations'" kind="violation"/>
        <ReviewManagement v-if="reviewsMounted" v-show="activeTab==='reviews'" ref="reviews"/>
        <div v-if="activeTab==='records' && correctionOpen" class="correction-back"><SButton size="sm" @click="closeCorrection">返回预约与使用记录</SButton></div>
        <CheckinCorrection ref="correction" v-if="correctionMounted" v-show="activeTab==='records' && correctionOpen"/>
        <ResourceManagement ref="resources" v-show="activeTab==='rooms'" @summary="roomStats=$event" />
        <UserManagement ref="users" v-show="activeTab==='users'" @summary="userStats=$event" />
      <ComplaintManagement v-if="complaintsMounted" v-show="activeTab==='complaints'" ref="complaints" />
        <RestrictionManagement v-if="restrictionsMounted" v-show="activeTab==='restrictions'" ref="restrictions" />
        <AppealManagement v-if="appealsMounted" v-show="activeTab==='appeals'" ref="appeals" />
      </div>
    </div>
  </div>
</template>
<style scoped>
.admin-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:20px}
.admin-kpi{display:grid;gap:4px;padding:18px 20px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-xl);box-shadow:var(--shadow-1)}
.admin-kpi span{color:var(--text-3);font-size:var(--fs-caption);letter-spacing:.06em}
.admin-kpi b{font-family:var(--font-display);font-size:34px;line-height:1.15;color:var(--text-1);font-variant-numeric:tabular-nums}
.admin-kpi small{color:var(--text-4);font-size:11px}
.admin-stats{margin-bottom:16px}
.admin-stats .card-title-row{margin-bottom:14px}
.admin-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:18px;align-items:start}
.admin-sidebar{position:sticky;top:16px}
.side-nav.admin-nav{display:flex;flex-direction:column;flex-wrap:nowrap;gap:4px}
.admin-nav-group-title{padding:12px 12px 5px;font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--text-4)}
.admin-nav-group-title:first-of-type{padding-top:0}
.admin-nav .side-nav-item{width:100%}
.admin-content{min-width:0;display:flex;flex-direction:column;gap:18px}
.correction-back{display:flex;justify-content:flex-end}
@media(max-width:1000px){
  .admin-layout{grid-template-columns:1fr}
  .admin-sidebar{position:static}
}
</style>
