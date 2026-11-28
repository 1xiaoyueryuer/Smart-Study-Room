<script setup>
import { computed,nextTick,onBeforeUnmount,onMounted,ref,watch } from 'vue'
import { useRoute } from 'vue-router'
import { listMyRestrictions,getBookingEligibility,getMyRestriction } from '../api/restriction'
import { validEligibility } from '../composables/restrictionForm.js'
import RestrictionRecord from './RestrictionRecord.vue'
import BookingRestrictionNotice from './BookingRestrictionNotice.vue'
import SButton from './ui/SButton.vue'
import SBanner from './ui/SBanner.vue'
import SEmpty from './ui/SEmpty.vue'
import {createRecordPager,recordFields} from '../composables/recordPage.js'
import RecordFilters from '../components/RecordFilters.vue'
import RecordPageControls from '../components/RecordPageControls.vue'
const route=useRoute(),pager=createRecordPager(listMyRestrictions),fields=recordFields('restriction')
const {items,loaded,loading,error,filters,snapshot,snapshotQuery}=pager
const eligibility=ref(null),eligibilityError=ref(''),eligibilityLoading=ref(false),linked=ref(null),linkedError=ref('')
const bookingStatus = computed(() => {
  if (!eligibility.value) return ''
  if (eligibility.value.can_book) return '你可以预约座位'
  return {
    role: '当前账号无法预约',
    disabled: '账号已停用',
    restrictions: '暂时无法预约座位'
  }[eligibility.value.blocked_by] || '当前无法预约'
})
const linkedId=computed(()=>{const text=String(route.query.restriction_id||'');return /^[1-9]\d*$/.test(text)&&Number.isSafeInteger(Number(text))?Number(text):null})
const linkedRecord=computed(()=>linked.value)
let alive=true,sequence=0,eligibilitySequence=0
async function focusLinked(){if(!linkedRecord.value)return;await nextTick();if(!alive||typeof document==='undefined')return;const element=document.getElementById(`restriction-${linkedId.value}`);element?.scrollIntoView({block:'center'});element?.focus({preventScroll:true})}
async function readLinked(){const id=linkedId.value,ticket=++sequence;linked.value=null;linkedError.value='';if(!id)return;try{const {data}=await getMyRestriction(id);if(!alive||ticket!==sequence)return;if(data?.id!==id)throw new Error('关联限制返回不完整');linked.value=data}catch(e){if(alive&&ticket===sequence)linkedError.value=e.message}}
async function readEligibility() {
  const ticket = ++eligibilitySequence
  eligibilityLoading.value = true
  eligibilityError.value = ''
  try {
    const { data } = await getBookingEligibility()
    if (!alive || ticket !== eligibilitySequence) return
    if (!validEligibility(data)) throw new Error('当前资格返回不完整')
    eligibility.value = data
  } catch (failure) {
    if (alive && ticket === eligibilitySequence) eligibilityError.value = failure.message
  } finally {
    if (alive && ticket === eligibilitySequence) eligibilityLoading.value = false
  }
}
async function refresh(){await Promise.all([pager.refresh(),readLinked(),readEligibility()]);await focusLinked()}
watch(linkedId,async()=>{await readLinked();await focusLinked()});onMounted(refresh);onBeforeUnmount(()=>{alive=false;sequence++;pager.dispose()})
defineExpose({refresh})
</script>
<template>
  <section id="restrictions" class="card restrictions-panel">
    <div class="card-title-row"><h3>预约状态</h3><SButton size="sm" :loading="loading || eligibilityLoading" @click="refresh">刷新</SButton></div>
    <SBanner v-if="linkedError" type="error" title="暂时无法打开这条预约限制">
      <SButton size="sm" :disabled="loading || eligibilityLoading" @click="refresh">重新查看</SButton>
    </SBanner>
    <section v-if="linkedRecord" :id="`restriction-${linkedRecord.id}`" tabindex="-1" class="record-box">
      <h4>这条消息对应的预约限制</h4>
      <RestrictionRecord :record="linkedRecord"/>
    </section>
    <p v-if="eligibilityLoading" role="status">正在查询预约状态…</p>
    <SBanner v-else-if="eligibilityError" type="error" title="暂时无法确认你能否预约">
      <SButton size="sm" :loading="eligibilityLoading" @click="readEligibility">重新查询</SButton>
    </SBanner>
    <div v-else-if="eligibility" class="row-actions">
      <p v-if="!eligibility.active_restrictions.length" role="status">{{ bookingStatus }}</p>
      <RouterLink v-if="eligibility.can_book" :to="{ name: 'booking' }">去预约</RouterLink>
    </div>
    <BookingRestrictionNotice v-if="eligibility && !eligibilityError && !eligibilityLoading && eligibility.active_restrictions.length" :records="eligibility.active_restrictions" :checked-at="eligibility.server_now" />
    <h4>限制记录</h4>
    <RecordFilters v-model="filters" :fields="fields" :disabled="loading" split-dates @apply="pager.apply"/>
    <p v-if="loading" role="status">正在加载限制记录…</p>
    <SBanner v-if="error" type="error" :title="error"><SButton size="sm" @click="refresh">重新查询记录</SButton></SBanner>
    <div v-if="loaded" class="record-box">
      <div v-for="record in items" :key="record.id" :id="record.id===linkedId?`restriction-page-${record.id}`:`restriction-${record.id}`" tabindex="-1" :class="{'linked-restriction':record.id===linkedId}">
        <RestrictionRecord :record="record" collapse-details/>
      </div>
      <SEmpty v-if="!items.length&&!error&&!loading" description="没有符合筛选条件的限制记录" />
    </div>
    <RecordPageControls :snapshot="snapshot" :query="snapshotQuery" :fields="fields" :disabled="loading" @page="pager.turn"/>
  </section>
</template>
<style scoped>
.restrictions-panel{display:grid;gap:16px;min-width:0}
.record-box{border:1px solid var(--border);border-radius:var(--r-lg);padding:16px;display:grid;gap:12px;min-width:0;min-height:120px}
.linked-restriction{outline:2px solid var(--primary);outline-offset:2px;border-radius:var(--r-md)}
</style>
