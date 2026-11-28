<script setup>
import { formatCampusDateTime } from '../composables/campusDateTime.js'
import {ref,computed,onMounted,onBeforeUnmount} from 'vue'
import {getRooms} from '../api/room'
import {listMyReservations} from '../api/reservation'
import {listRoomReviews,listAllRoomReviews} from '../api/review'
import {createRecordPager} from '../composables/recordPage.js'
import {hasCompletedReviewUsage,validReviewPage,validPublicReview} from '../composables/reviewManagement.js'
import {useAuthStore} from '../stores/auth'
import ReviewEditor from '../components/ReviewEditor.vue'
import SSelect from '../components/ui/SSelect.vue'
import SButton from '../components/ui/SButton.vue'
import SBanner from '../components/ui/SBanner.vue'
import SEmpty from '../components/ui/SEmpty.vue'
const props = defineProps({ roomId: { type: Number, default: null } })
const singleRoom = computed(() => props.roomId !== null)
const auth = useAuthStore()
const showUsagePicker = ref(false), reviewEditor = ref(null)
const usagePager = createRecordPager(listMyReservations, { initial: { record_type: 'usage' } })
const {items: usageRows, snapshot: usagePage, loading: usageLoading, error: usageError} = usagePager
const reviewableUsage = computed(() => usageRows.value.filter(hasCompletedReviewUsage))
const hasMoreUsage = computed(() => Boolean(usagePage.value && usagePage.value.page * usagePage.value.page_size < usagePage.value.total))
const requestedUsagePage = ref(1)

function loadUsagePage(page) {
  requestedUsagePage.value = page
  return usagePager.turn(page)
}

function toggleUsagePicker() {
  if (singleRoom.value || !auth.isOrdinary) return
  showUsagePicker.value = !showUsagePicker.value
  if (showUsagePicker.value) return loadUsagePage(1)
}

function openUsageReview(reservation) {
  if (!reviewableUsage.value.includes(reservation) || usageLoading.value || usageError.value) return
  return reviewEditor.value?.open(reservation.id, `${reservation.room_name} · ${reservation.seat_no}`)
}

const rooms=ref([]),room=ref(null),snapshot=ref(null),snapshotKey=ref(undefined),loading=ref(false),roomLoading=ref(false),error=ref(''),roomError=ref('');let alive=true,ticket=0
onBeforeUnmount(()=>{alive=false;ticket++;usagePager.dispose()})
const roomOptions=computed(()=>rooms.value.map(r=>({value:r.id,label:r.name})))
const currentKey = () => {
  const selected = props.roomId ?? room.value
  return selected === null || selected === 'all' ? 'all' : Number(selected)
}
async function loadRooms(){roomLoading.value=true;roomError.value='';try{const {data}=await getRooms();if(!alive)return;if(!Array.isArray(data)||!data.every(r=>Number.isSafeInteger(r.id)&&r.id>0&&typeof r.name==='string'))throw new Error('空间列表不完整');rooms.value=data;if(snapshot.value===null)await load(1)}catch(e){if(alive)roomError.value=e.message}finally{if(alive)roomLoading.value=false}}
async function load(page = 1) {
  const key = currentKey()
  if (key !== 'all' && (!Number.isSafeInteger(key) || key < 1)) {
    error.value = '请先选择自习室'
    return
  }
  const current = ++ticket
  const params = { page, page_size: 10 }
  loading.value = true
  error.value = ''
  try {
    const { data } = await (key === 'all' ? listAllRoomReviews(params) : listRoomReviews(key, params))
    if (!alive || current !== ticket) return
    if (!validReviewPage(data, params, validPublicReview)) throw new Error('空间评价响应不完整')
    snapshot.value = data
    snapshotKey.value = key
  } catch (failure) {
    if (alive && current === ticket) error.value = failure.message
  } finally {
    if (alive && current === ticket) loading.value = false
  }
}
async function refreshAll(){await loadRooms();await load(1)}
onMounted(() => singleRoom.value ? load(1) : loadRooms())
</script>
<template>
  <div class="room-reviews" :class="{ 'page-view': !singleRoom }">
    <header v-if="!singleRoom" class="view-heading review-heading">
      <div class="heading-copy">
        <h1>空间评价</h1>
        <p class="heading-sub">评价将匿名展示，请勿填写个人信息。</p>
      </div>
      <SButton v-if="auth.isOrdinary" variant="primary" :aria-expanded="showUsagePicker" aria-controls="review-usage-picker" @click="toggleUsagePicker">{{ showUsagePicker ? '收起使用记录' : '写评价' }}</SButton>
    </header>
    <template v-if="!singleRoom && auth.isOrdinary">
      <section v-show="showUsagePicker" id="review-usage-picker" class="card usage-picker" aria-labelledby="review-usage-heading">
        <h2 id="review-usage-heading">选择一次使用记录</h2>
        <p v-if="usageLoading" role="status">正在加载你的使用记录…</p>
        <SBanner v-else-if="usageError" type="error" title="暂时无法加载使用记录">
          <SButton size="sm" @click="loadUsagePage(requestedUsagePage)">重试</SButton>
        </SBanner>
        <ul v-else-if="reviewableUsage.length" class="usage-options">
          <li v-for="reservation in reviewableUsage" :key="reservation.id">
            <div class="usage-summary">
              <strong>{{ reservation.room_name }} · {{ reservation.seat_no }}</strong>
              <span>{{ reservation.res_date }} {{ reservation.start_time?.slice(0, 5) }}–{{ reservation.end_time?.slice(0, 5) }}</span>
            </div>
            <SButton size="sm" variant="soft" :aria-label="`评价 ${reservation.room_name} ${reservation.seat_no} ${reservation.res_date} ${reservation.start_time?.slice(0, 5)}`" @click="openUsageReview(reservation)">评价</SButton>
          </li>
        </ul>
        <p v-else role="status">{{ hasMoreUsage || usagePage?.page > 1 ? '这一页没有可评价的记录。' : '完成一次签到使用后，就可以评价自习室。' }}</p>
        <div v-if="hasMoreUsage || usagePage?.page > 1" class="actions">
          <SButton size="sm" :disabled="usageLoading || usagePage.page <= 1" @click="loadUsagePage(usagePage.page - 1)">上一页</SButton>
          <SButton size="sm" :disabled="usageLoading || !hasMoreUsage" @click="loadUsagePage(usagePage.page + 1)">下一页</SButton>
        </div>
      </section>
      <ReviewEditor ref="reviewEditor" @saved="load(1)" />
    </template>
    <section class="review-panel" :class="{ card: !singleRoom }">
      <template v-if="!singleRoom">
        <div class="card-title-row"><h3>选择空间</h3><SButton size="sm" :loading="roomLoading" :disabled="loading" @click="refreshAll">刷新</SButton></div>
        <form class="review-query-row" @submit.prevent="load(1)">
          <label class="query-field">空间<SSelect v-model="room" :options="roomOptions" clearable :disabled="roomLoading" @change="load(1)"/></label>
          <SButton type="submit" :disabled="loading||roomLoading">{{currentKey()==='all'?'查询全部评价':'查询空间评价'}}</SButton>
        </form>
      </template>
      <SBanner v-if="roomError" type="error" :title="roomError"/>
      <SBanner v-if="error" type="error" :title="singleRoom ? '暂时无法加载评价' : error">
        <SButton v-if="singleRoom" size="sm" @click="load(snapshot?.page || 1)">重试</SButton>
      </SBanner>
      <p v-if="loading" role="status">正在加载评价…</p>
      <p v-if="snapshot&&snapshotKey!==currentKey()" class="muted">当前所选空间尚未成功读取，下方为上次结果。</p>
      <section v-if="snapshot || !singleRoom" :class="{ 'result-box': !singleRoom }">
        <div v-if="snapshot&&snapshot.items.length" class="review-cards">
          <article v-for="item in snapshot.items" :key="item.id">
            <h3>匿名评价 · {{item.rating}}星</h3>
            <p class="content">{{item.content}}</p>
            <p>评价更新：{{ formatCampusDateTime(item.updated_at) }}</p>
            <template v-if="item.admin_reply"><h4>管理回复</h4><p class="content">{{item.admin_reply}}</p><p>回复登记：{{ formatCampusDateTime(item.replied_at) }}</p></template>
          </article>
        </div>
        <SEmpty v-else-if="snapshot" icon="ticket" :description="singleRoom ? '这间自习室还没有公开评价' : '该次查询暂无公开评价'" />
        <SEmpty v-else-if="!loading&&!error&&!roomLoading" icon="ticket" description="暂无公开评价" />
      </section>
      <div v-if="snapshot && (!singleRoom || snapshot.total > snapshot.page_size)" class="list-footer">
        <span>共 {{ snapshot.total }} 条</span>
        <span class="page-info">第 {{ snapshot.page }} / {{ Math.max(1, Math.ceil(snapshot.total / snapshot.page_size)) }} 页</span>
        <div class="actions">
          <SButton :disabled="loading||snapshot.page<=1||snapshotKey!==currentKey()" @click="load(snapshot.page-1)">上一页</SButton>
          <SButton :disabled="loading||snapshot.page*snapshot.page_size>=snapshot.total||snapshotKey!==currentKey()" @click="load(snapshot.page+1)">下一页</SButton>
        </div>
      </div>
    </section>
  </div>
</template>
<style scoped>
.room-reviews,.review-panel,.room-reviews label,.review-cards{display:grid;gap:16px;min-width:0;overflow-wrap:anywhere}
.review-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:6px; }
.usage-picker { display:grid; gap:12px; }
.usage-picker h2 { font-size:var(--fs-body); }
.usage-options { list-style:none; margin:0; padding:0; }
.usage-options li { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 0; border-top:1px solid var(--border); }
.usage-summary { min-width:0; display:grid; gap:3px; }
.usage-summary span { color:var(--text-3); font-size:var(--fs-caption); }
.card-title-row{margin-bottom:0}
.review-query-row{display:flex;align-items:flex-end;gap:12px;min-width:0}
.review-query-row .query-field{flex:1;min-width:0;display:grid;gap:7px}
.review-query-row :deep(.s-btn){flex:0 0 auto;align-self:flex-end}
.result-box{min-height:240px;padding:20px 22px;border:1px solid var(--border);border-radius:var(--r-lg);background:var(--surface);display:flex;flex-direction:column;justify-content:center}
.result-box .empty-state{margin:auto}
.review-cards article{border-top:1px solid var(--border);padding-top:16px;display:grid;gap:10px}
.review-cards article:first-child{border-top:none;padding-top:0}
.content{white-space:pre-wrap;overflow-wrap:anywhere}
.actions{display:flex;flex-wrap:wrap;gap:12px}
.list-footer{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;margin-top:4px;color:var(--text-3);font-size:var(--fs-caption)}
.page-info{text-align:center;white-space:nowrap}
.list-footer .actions{justify-content:flex-end}
@media(max-width:620px){.review-query-row{flex-direction:column;align-items:stretch}.review-query-row :deep(.s-btn){width:100%}.list-footer{display:flex;flex-wrap:wrap}}
</style>
