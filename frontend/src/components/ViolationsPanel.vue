<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { listMyViolations,getMyViolation } from '../api/violation'
import SButton from './ui/SButton.vue'
import SBanner from './ui/SBanner.vue'
import STag from './ui/STag.vue'
import SEmpty from './ui/SEmpty.vue'
import {createRecordPager,recordFields} from '../composables/recordPage.js'
import RecordFilters from '../components/RecordFilters.vue'
import RecordPageControls from '../components/RecordPageControls.vue'
import { formatCampusDateTime } from '../composables/campusDateTime.js'
const props = defineProps({ autoLoad: { type:Boolean, default:true } })
const route = useRoute()
const pager=createRecordPager(listMyViolations),fields=recordFields('violation')
const {items,loading,error,loaded,filters,snapshot,snapshotQuery}=pager
const linked=ref(null),linkedError=ref('')
const typeLabels = { abandon:'开始后主动放弃', no_show:'超时未签到', occupation_refusal:'核实拒不配合占座' }
const linkedId = computed(() => {const value=String(route.query.violation_id||'');return /^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null})
const linkedRecord=computed(()=>linked.value)
const displayItems=computed(()=>items.value)
async function focusLinked() {if(!linkedRecord.value)return;await nextTick();if(!alive||typeof document==='undefined')return;const element=document.getElementById(`violation-${linkedId.value}`);element?.scrollIntoView({block:'center'});element?.focus({preventScroll:true})}
let sequence=0,alive=true
async function readLinked(){const id=linkedId.value,ticket=++sequence;linked.value=null;linkedError.value='';if(!id)return;try{const {data}=await getMyViolation(id);if(!alive||ticket!==sequence)return;if(data?.id!==id)throw new Error('关联违规返回不完整');linked.value=data}catch(e){if(alive&&ticket===sequence)linkedError.value=e.message}}
watch(linkedId,async()=>{await readLinked();await focusLinked()})
async function refresh(){await Promise.all([pager.refresh(),readLinked()]);await focusLinked()}
onMounted(() => { if (props.autoLoad) void refresh() })
onBeforeUnmount(()=>{alive=false;sequence++;pager.dispose()})
defineExpose({ refresh })
</script>
<template>
  <section id="violations" class="card">
    <div class="card-title-row"><h3>违规记录</h3><SButton size="sm" :loading="loading" @click="refresh">刷新</SButton></div>
    <RecordFilters v-model="filters" :fields="fields" :disabled="loading" @apply="pager.apply"/>
    <SBanner v-if="linkedError" type="error" title="暂时无法打开这条违规记录">
      <SButton size="sm" :disabled="loading" @click="refresh">重新查看</SButton>
    </SBanner>
    <section v-if="linkedRecord" :id="`violation-${linkedRecord.id}`" class="linked-violation-detail" tabindex="-1">
      <h4>违规记录 #{{ linkedRecord.id }}</h4>
      <p>{{ typeLabels[linkedRecord.type] || linkedRecord.type }} · {{ linkedRecord.status === 'active' ? '有效' : linkedRecord.status === 'revoked' ? '已撤销' : linkedRecord.status }}</p>
      <p>发生时间 {{ formatCampusDateTime(linkedRecord.occurred_at) }}</p>
      <p v-if="linkedRecord.reason && linkedRecord.reason !== '签到期限到达仍未签到'" class="violation-reason">{{ linkedRecord.reason }}</p>
      <p v-if="linkedRecord.revocation">撤销原因：{{ linkedRecord.revocation.reason }} · {{ formatCampusDateTime(linkedRecord.revocation.revoked_at) }}</p>
    </section>
    <p v-if="loading" role="status">正在加载违规记录…</p>
    <SBanner v-else-if="error" type="error" :title="error"><SButton size="sm" @click="refresh">重新查询记录</SButton></SBanner>
    <p v-else-if="!loaded" role="status" class="muted">等待加载违规记录…</p>
    <template v-if="loaded">
      <div class="table-wrap">
        <div class="table-scroll" tabindex="0" aria-label="违规记录，可左右滑动">
          <table class="table violation-table">
            <thead>
              <tr><th>记录</th><th>违规类型</th><th>发生时间</th><th>登记时间</th><th>状态与来源</th><th>登记人</th><th>通知发出时间</th><th>原因</th><th>申诉</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in displayItems" :key="item.id" :id="item.id === linkedId ? `violation-page-${item.id}` : `violation-${item.id}`"
                  tabindex="-1" :class="{ 'linked-violation': item.id === linkedId }">
                <td>
                  <strong>违规记录 #{{ item.id }}</strong>
                  <div v-if="item.source === 'manual'">涉及他人预约</div>
                  <div v-else-if="item.reservation_id">预约 #{{ item.reservation_id }}</div>
                </td>
                <td>{{ typeLabels[item.type] || item.type }}</td>
                <td>{{ formatCampusDateTime(item.occurred_at) }}</td>
                <td>{{ formatCampusDateTime(item.registered_at) }}</td>
                <td>
                  <STag :type="item.status === 'active' ? 'danger' : 'neutral'">
                    {{ item.status === 'active' ? '有效' : item.status === 'revoked' ? '已撤销' : item.status }}
                  </STag>
                  <div>{{ item.source === 'automatic' ? '系统登记' : item.source === 'manual' ? '管理员核实' : item.source }}</div>
                </td>
                <td>{{ item.registrant_display_name || (item.source === 'automatic' ? '系统' : '未记录') }}</td>
                <td>{{ item.notified_at ? formatCampusDateTime(item.notified_at) : '未记录' }}</td>
                <td class="violation-reason">
                  <span v-if="item.reason !== '签到期限到达仍未签到'">{{ item.reason }}</span>
                  <p v-if="item.revocation">撤销原因：{{ item.revocation.reason }}<br />撤销时间：{{ formatCampusDateTime(item.revocation.revoked_at) }} · {{ item.revocation.revoker_display_name }}</p>
                </td>
                <td><RouterLink :to="{ path: '/appeals/new', query: { violation_id: item.id } }">查看申诉</RouterLink></td>
              </tr>
            </tbody>
          </table>
          <SEmpty v-if="!items.length && !error && !loading" description="没有符合筛选条件的违规记录" />
        </div>
      </div>
    </template>
    <RecordPageControls :snapshot="snapshot" :query="snapshotQuery" :fields="fields" :disabled="loading" @page="pager.turn"/>
  </section>
</template>
<style scoped>
.violation-table { min-width:1420px; }.violation-reason{white-space:pre-wrap;overflow-wrap:anywhere}.linked-violation{outline:2px solid var(--primary);outline-offset:-2px}
.linked-violation-detail { display: grid; gap: 6px; padding: 12px 16px; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-2); }
.linked-violation-detail h4, .linked-violation-detail p { margin: 0; }
.table-wrap { margin-top: 20px; }
</style>
