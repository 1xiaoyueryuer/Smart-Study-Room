<script setup>
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import PageHelp from '../components/PageHelp.vue'
import SAnimatedNumber from '../components/ui/SAnimatedNumber.vue'
import {ref,computed,onMounted,nextTick,watch,onUnmounted} from 'vue'
import * as echarts from 'echarts'
import {getRooms} from '../api/room'
import {getHeatmap,getOverview} from '../api/stats'
import {statsQuery,validOverview,validHeatmap,usageHours,ratioText} from '../composables/statsForm.js'
import {overviewChartOptions,heatChartOption,roomBarOption} from '../composables/statsCharts.js'
import {createStatsRefresh} from '../composables/statsRefresh.js'
import {useThemeStore} from '../stores/theme'
import SSelect from '../components/ui/SSelect.vue'
import SDatePicker from '../components/ui/SDatePicker.vue'
import SBanner from '../components/ui/SBanner.vue'
import SButton from '../components/ui/SButton.vue'

const themeStore=useThemeStore()
const chartTab=ref('heat'),chartRoot=ref(null)
const chartTabs=[{key:'heat',label:'座位热力图'},{key:'trend',label:'运营趋势'},{key:'rooms',label:'空间对比'},{key:'top',label:'热门座位'}]
const rooms=ref([]),roomsError=ref(''),roomId=ref(null),date=ref(''),formError=ref('')
const roomOptions=computed(()=>[{id:null,name:'全校'},...rooms.value])
const overview=ref(null),heatmap=ref(null),overviewError=ref(''),heatError=ref('')
const overviewLoading=ref(false),heatLoading=ref(false),attemptedQuery=ref(null),heatQuery=ref(null),statsVisible=ref(true)
const heatApplicable=computed(()=>Boolean(attemptedQuery.value?.room_id))
const heatEl=ref(null),trendEl=ref(null),peakEl=ref(null),topEl=ref(null),roomBarEl=ref(null)
let heatChart,trendChart,peakChart,topChart,roomBarChart,resizeObserver
const roomBars=ref([]),roomBarsLoading=ref(false),roomBarsError=ref('')
let roomBarSequence=0
let disposed=false,selectionSequence=0,roomsRequest=0,heatCompletion=Promise.resolve(null),autoDate=null
const motionMedia=window.matchMedia('(prefers-reduced-motion: reduce)')
const animateCharts=()=>!motionMedia.matches
const CHART=computed(()=>{const dark=themeStore.isDark;return{axisLine:dark?'#33453a':'#d7cab2',splitLine:dark?'#24312a':'#efe7d8',label:dark?'#8d9c90':'#7b877d',title:dark?'#f1f5ee':'#4f5f54',tooltipBg:dark?'#1a241e':'#23372d',heatRange:dark?['#202c25','#7fb391']:['#f3ecdd','#2f5d46'],heatBorder:dark?'#1a241e':'#fffdf8'}})
function roomName(id) {
 return id ? rooms.value.find(room=>room.id===id)?.name ?? `空间 #${id}` : '全校'
}
const scopeText=computed(()=>overview.value ? `${roomName(overview.value.scope.room_id)} · ${overview.value.scope.selected_date}` : '')
const attemptedText=computed(()=>attemptedQuery.value ? `${roomName(attemptedQuery.value.room_id)} · ${attemptedQuery.value.date||'今天'}` : '')
const heatAttemptedText=computed(()=>heatQuery.value?`${roomName(heatQuery.value.room_id)} · ${heatQuery.value.date}`:attemptedText.value)
const dayMetrics=computed(()=>overview.value ? [
 {label:'新建预约',value:overview.value.day.created_count},
 {label:'取消预约',value:overview.value.day.cancelled_count},
 {label:'签到人次',value:overview.value.day.checkin_count},
 {label:'使用时长（人·小时）',text:usageHours(overview.value.day.usage_seconds).toFixed(2)},
 {label:'有效违规',value:overview.value.day.active_violation_count}
] : [])
function snapshotText(value){return value ? formatCampusDateTime(value) : '尚未读取'}
function createChart(element,height=320){if(!element?.clientWidth)return null;return echarts.init(element,null,{width:element.clientWidth,height:element.clientHeight||height})}
async function renderOverview(){
 const data=overview.value
 if(!data)return
 await nextTick()
 if(disposed||data!==overview.value)return
 const options=overviewChartOptions(data,CHART.value,animateCharts())
 if(!trendChart)trendChart=createChart(trendEl.value)
 if(!peakChart)peakChart=createChart(peakEl.value)
 if(!topChart)topChart=createChart(topEl.value,340)
 trendChart?.setOption(options.trend,true);peakChart?.setOption(options.peak,true);topChart?.setOption(options.top,true)
 resizeAll()
}
async function renderHeatmap(){
 const data=heatmap.value
 if(!data)return
 await nextTick()
 if(disposed||data!==heatmap.value)return
 if(!heatChart)heatChart=createChart(heatEl.value,380)
 heatChart?.setOption(heatChartOption(data,CHART.value,animateCharts()),true)
 resizeAll()
}
async function loadRoomBars(){
 const sequence=++roomBarSequence
 const targets=(roomId.value?rooms.value.filter(room=>room.id===roomId.value):rooms.value.filter(room=>room.enabled!==false))
 roomBarsLoading.value=true;roomBarsError.value=''
 try{
  const settled=await Promise.allSettled(targets.map(async room=>{
   const query={room_id:room.id,...(date.value?{date:date.value}:{})}
   const {data}=await getOverview(query)
   if(!validOverview(data,query))throw new Error(`${room.name} 统计回执不完整`)
   return {id:room.id,name:room.name,usage_seconds:data.day.usage_seconds,checkin_count:data.day.checkin_count,created_count:data.day.created_count,snapshot_at:data.snapshot_at,selected_date:data.scope.selected_date}
  }))
  if(disposed||sequence!==roomBarSequence)return
  roomBars.value=settled.filter(result=>result.status==='fulfilled').map(result=>result.value)
  const failed=settled.filter(result=>result.status==='rejected')
  if(!roomBars.value.length)roomBarsError.value='暂时无法加载空间对比'
  else if(failed.length)roomBarsError.value=`${failed.length} 个空间的数据暂时无法加载`
  await renderRoomBars()
 } finally { if(!disposed&&sequence===roomBarSequence)roomBarsLoading.value=false }
}
async function renderRoomBars(){
 await nextTick()
 if(disposed||!roomBarEl.value?.clientWidth)return
 if(!roomBarChart)roomBarChart=echarts.init(roomBarEl.value,null,{width:roomBarEl.value.clientWidth,height:roomBarEl.value.clientHeight||340})
 roomBarChart.setOption(roomBarOption(roomBars.value,CHART.value,animateCharts()),true)
 resizeAll()
}
async function loadRooms(){
 const sequence=++roomsRequest;roomsError.value=''
 try{const response=await getRooms();if(disposed||sequence!==roomsRequest)return;rooms.value=response.data||[]}
 catch(error){if(!disposed&&sequence===roomsRequest)roomsError.value=error.message||'空间读取失败'}
}
function selectHeat(query){heatQuery.value=query?{...query}:null;heatCompletion=statsRefresh.select('heat',query,{refresh:false});return heatCompletion}
const statsRefresh=createStatsRefresh({onVisibility:visible=>{statsVisible.value=visible},resources:{
 overview:{
  read:query=>getOverview(query),
  success:async(response,query)=>{
   if(!validOverview(response.data,query))throw new Error('统计回执不完整或与查询不符，请重新读取')
   overview.value=response.data
   // An omitted date remains server-campus-today on later refreshes and midnight rollover.
   if(!query.date){const selected=response.data.scope.selected_date;if(!date.value||date.value===autoDate)date.value=selected;autoDate=selected;if(query.room_id)selectHeat({...query,date:selected})}
   await renderOverview();return response.data
  },
  failure:error=>{overviewError.value=error.message||'统计读取失败'},
  loading:value=>{overviewLoading.value=value;if(value)overviewError.value=''}
 },
 heat:{
  read:query=>getHeatmap(query.room_id,query.date),
  success:async(response,query)=>{if(!validHeatmap(response.data,query))throw new Error('热力图回执不完整或与查询不符，请重新读取');heatmap.value=response.data;await renderHeatmap();return response.data},
  failure:error=>{heatError.value=error.message||'热力图读取失败'},
  loading:value=>{heatLoading.value=value;if(value)heatError.value=''}
 }
}})
async function applyQuery(query){
 const selection=++selectionSequence
 attemptedQuery.value={...query};overviewError.value='';heatError.value=''
 const completion=statsRefresh.select('overview',query)
 const initialHeat=selectHeat(query.room_id&&query.date?query:null)
 if(query.room_id&&query.date)await statsRefresh.refresh('heat')
 const result=await completion
 if(disposed||selection!==selectionSequence)return
 if(query.room_id&&!query.date&&result)await heatCompletion
 else await initialHeat
}
function applyFilters(){formError.value='';try{return applyQuery(statsQuery({room_id:roomId.value,date:date.value}))}catch(error){formError.value=error.message}}
function retryOverview(){return statsRefresh.refresh('overview')}
function retryHeat(){return statsRefresh.refresh('heat')}
function resizeAll(){for(const chart of [heatChart,trendChart,peakChart,topChart,roomBarChart]){const element=chart?.getDom();if(element?.clientWidth&&element.clientHeight)chart.resize({width:element.clientWidth,height:element.clientHeight})}}
function redraw(){renderOverview();renderHeatmap();if(chartTab.value==='rooms')loadRoomBars()}
watch(()=>themeStore.resolvedTheme,redraw)
watch(chartTab,async()=>{await nextTick();if(disposed)return;if(chartTab.value==='rooms')await loadRoomBars();await Promise.all([renderOverview(),renderHeatmap()]);if(!disposed)resizeAll()})
onMounted(()=>{resizeObserver=new ResizeObserver(resizeAll);resizeObserver.observe(chartRoot.value);motionMedia.addEventListener('change',redraw);window.addEventListener('resize',resizeAll);loadRooms();applyQuery({});statsRefresh.start()})
onUnmounted(()=>{disposed=true;++selectionSequence;++roomsRequest;++roomBarSequence;statsRefresh.stop();resizeObserver?.disconnect();motionMedia.removeEventListener('change',redraw);window.removeEventListener('resize',resizeAll);for(const chart of [heatChart,trendChart,peakChart,topChart,roomBarChart])chart?.dispose()})
</script>

<template>
 <div v-reveal class="page-view">
  <header class="view-heading has-page-help"><div class="heading-copy" data-page-title><h1>热力图与统计</h1></div><PageHelp title="怎么看统计"><ul class="tips">
   <li>新建和取消预约按操作当天统计。</li>
   <li>当前使用比例只统计开放且可用的座位。</li>
   <li>近 7 天的图表包含今天和前 6 天。</li>
  </ul></PageHelp></header>
  <div class="split analytics-split"><div class="split-left">
   <section class="card stats-panel">
    <div class="card-title-row"><h3>统计筛选</h3></div>
    <div class="stats-filters" role="group" aria-label="统计筛选">
     <div class="filter-row"><label>空间</label><SSelect v-model="roomId" :options="roomOptions" label-key="name" value-key="id" /></div>
     <div class="filter-row"><label>日期</label><SDatePicker v-model="date" /></div>
     <div class="filter-actions"><SButton type="button" @click="applyFilters">应用筛选</SButton><SButton type="button" variant="ghost" @click="date='';applyFilters()">今天</SButton></div>
    </div>
    <SBanner v-if="formError" type="error" :title="formError" />
    <SBanner v-if="roomsError" type="error" title="暂时无法加载空间列表"><SButton size="sm" @click="loadRooms">重试</SButton></SBanner>
    <div class="snapshot-block">
     <div class="snapshot-head"><h4>统计概览</h4><span v-if="overview" class="muted">更新于 {{ snapshotText(overview.snapshot_at) }}</span></div>
     <p v-if="overviewLoading&&!overview" role="status">正在加载统计…</p>
     <SBanner v-if="overviewError" type="error" title="暂时无法加载统计">
      <p>{{ attemptedText }}<span v-if="overview"> · 下方显示上次的数据</span></p>
      <SButton size="sm" @click="retryOverview">重试</SButton>
     </SBanner>
     <template v-if="overview">
      <p class="snapshot-scope">{{ scopeText }}</p>
      <div class="kpi-grid"><div v-for="metric in dayMetrics" :key="metric.label" class="kpi"><div class="kpi-num"><span v-if="metric.text!==undefined">{{ metric.text }}</span><SAnimatedNumber v-else :value="metric.value" /></div><div class="kpi-label">{{ metric.label }}</div></div></div>
      <h5>当前情况</h5>
      <dl class="current-metrics">
       <dt>开放可用座位</dt><dd>{{ overview.current.open_available_seats }}</dd>
       <dt>使用中的座位</dt><dd>{{ overview.current.in_use_now }}</dd>
       <dt>使用比例</dt><dd>{{ ratioText(overview.current.usage_ratio) }}</dd>
       <dt>待处理投诉</dt><dd>{{ overview.current.complaint_todo_count }}</dd>
       <dt>待确认投诉</dt><dd>{{ overview.current.complaint_awaiting_count }}</dd>
      </dl>
     </template>
     <p v-else-if="!overviewLoading&&!overviewError" class="muted">暂无统计数据</p>
    </div>
   </section>
  </div><div ref="chartRoot" class="split-right">
   <nav class="chart-tabs" aria-label="统计视图"><button v-for="tab in chartTabs" :key="tab.key" type="button" :class="{active:chartTab===tab.key}" :aria-pressed="chartTab===tab.key" @click="chartTab=tab.key">{{ tab.label }}</button></nav>
   <section v-show="chartTab==='heat'" class="card chart-panel"><div class="card-title-row"><h3>各座位分时使用情况</h3></div>
    <p v-if="!heatApplicable" class="muted">选择一个空间，再点「应用筛选」查看热力图。</p>
    <p v-if="heatLoading" role="status" class="muted">正在加载热力图…</p>
    <SBanner v-if="heatError" type="error" title="暂时无法加载热力图">
     <p>{{ heatAttemptedText }}<span v-if="heatmap"> · 下方显示上次的数据</span></p>
     <SButton size="sm" @click="retryHeat">重试</SButton>
    </SBanner>
    <div v-show="heatApplicable&&heatmap">
     <p v-if="heatmap" class="snapshot-scope">{{ heatmap.room.name }} · {{ heatmap.date }} · 更新于 {{ snapshotText(heatmap.snapshot_at) }}</p>
     <p class="muted">每格代表一小时，含已停用座位的历史记录。</p>
     <p v-if="heatmap&&!heatmap.seats.length" class="muted">这个空间暂无座位记录</p>
     <div class="responsive-scroll" tabindex="0" aria-label="座位时段使用记录，可左右滑动"><div ref="heatEl" class="chart chart-heat chart-wide"></div></div>
    </div>
    <p v-if="heatApplicable&&!heatmap&&!heatLoading&&!heatError" class="muted">暂无热力图数据</p>
   </section>
   <section v-show="chartTab==='trend'" class="card chart-panel">
    <div class="card-title-row"><h3>近 7 天趋势</h3></div>
    <p v-if="overview" class="snapshot-scope">{{ overview.scope.trend_from }} 至 {{ overview.scope.trend_to }}</p>
    <p v-else-if="!overviewLoading" class="muted">暂无趋势数据</p>
    <div v-show="overview" class="charts-row"><div ref="trendEl" class="chart"></div><div ref="peakEl" class="chart"></div></div>
   </section>
   <section v-show="chartTab==='rooms'" class="card chart-panel">
    <div class="card-title-row"><h3>空间使用对比</h3></div>
    <p v-if="roomBarsLoading" role="status" class="muted">正在加载空间对比…</p>
    <SBanner v-if="roomBarsError" type="error" :title="roomBarsError"><SButton size="sm" @click="loadRoomBars">重试</SButton></SBanner>
    <p v-if="roomBars.length" class="snapshot-scope">{{ roomBars[0]?.selected_date }} · {{ roomBars.length }} 个空间</p>
    <p v-else-if="!roomBarsLoading&&!roomBarsError" class="muted">暂无可比较的空间数据</p>
    <div v-show="roomBars.length" class="responsive-scroll" tabindex="0" aria-label="空间使用对比柱状图，可左右滑动"><div ref="roomBarEl" class="chart chart-bar"></div></div>
   </section>
   <section v-show="chartTab==='top'" class="card chart-panel">
    <div class="card-title-row"><h3>近 7 天热门座位</h3></div>
    <p v-if="overview?.top_seats.length" class="muted">使用时长前 10 名，含已停用座位的历史记录。</p>
    <p v-else-if="overview" class="muted">这段时间暂无使用记录</p>
    <p v-else-if="!overviewLoading" class="muted">暂无座位排名</p>
    <div v-show="overview" class="responsive-scroll" tabindex="0" aria-label="热门座位图，可左右滑动"><div ref="topEl" class="chart chart-bar"></div></div>
   </section>
  </div></div>
 </div>
</template>

<style scoped>
.analytics-split .split-left{grid-template-columns:minmax(0,1fr)}
.stats-panel{display:grid;gap:16px;min-width:0}
.stats-filters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end}
.filter-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:end}
.snapshot-block{border-top:1px solid var(--hairline);padding-top:16px;display:grid;gap:14px}
.snapshot-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
.snapshot-head h4{font-family:var(--font-display);font-size:20px;color:var(--text-1)}
.snapshot-head .muted{font-size:var(--fs-caption);color:var(--text-3)}
@media(max-width:820px){.stats-filters{grid-template-columns:1fr}}
.stats-panel .kpi-grid{grid-template-columns:repeat(5,minmax(0,1fr))}
@media(max-width:1000px){.stats-panel .kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.chart{width:100%;height:360px}.chart-heat{height:380px}.chart-wide{min-width:720px}.chart-bar{min-width:620px;height:340px}
.charts-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}.charts-row>.chart{min-width:0}.snapshot-scope{overflow-wrap:anywhere;color:var(--text-3);font-size:var(--fs-caption);line-height:1.65}
.current-metrics{display:grid;grid-template-columns:1fr auto;gap:8px 12px;font-size:var(--fs-caption)}.current-metrics dt{color:var(--text-3)}.current-metrics dd{margin:0;font-weight:600}
@media(max-width:720px){.chart{height:340px}.chart-heat{height:360px}.chart-bar{height:340px}}
@media(max-width:1100px){.charts-row{grid-template-columns:1fr}}
</style>
