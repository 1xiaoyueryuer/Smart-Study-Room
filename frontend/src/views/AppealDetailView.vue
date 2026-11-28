<script setup>
import {onBeforeUnmount,ref,watch} from 'vue'
import {getAppeal} from '../api/appeal'
import {validAppealDetail} from '../composables/appealForm.js'
import AppealRecord from '../components/AppealRecord.vue'
import SButton from '../components/ui/SButton.vue'
import SBanner from '../components/ui/SBanner.vue'
const props=defineProps({id:{type:[String,Number],required:true}}),record=ref(null),loading=ref(false),error=ref('');let alive=true,sequence=0
async function load() {
  const ticket = ++sequence, id = props.id
  loading.value = true
  error.value = ''
  record.value = null
  try {
    const response = await getAppeal(id)
    if (!alive || ticket !== sequence) return
    if (validAppealDetail(response.data) && String(response.data.id) === String(id)) {
      record.value = response.data
    } else {
      error.value = '暂时无法显示这条申诉。'
    }
  } catch (failure) {
    if (alive && ticket === sequence) {
      error.value = failure.status === 404 ? '找不到这条申诉。' : '暂时无法加载申诉详情。'
    }
  } finally {
    if (alive && ticket === sequence) loading.value = false
  }
}
watch(()=>props.id,load,{immediate:true});onBeforeUnmount(()=>{alive=false;sequence++})
</script>
<template>
  <div class="page-view appeal-detail">
    <header class="view-heading" data-page-title>
      <h1>申诉详情</h1>
      <RouterLink to="/profile#appeals">返回我的申诉</RouterLink>
    </header>
    <section class="card">
      <p v-if="loading" role="status">正在加载申诉…</p>
      <SBanner v-else-if="error" type="error" :title="error">
        <SButton @click="load">重新加载</SButton>
      </SBanner>
      <template v-else-if="record">
        <SButton @click="load">更新进度</SButton>
        <AppealRecord :record="record" />
      </template>
    </section>
  </div>
</template>
<style scoped>.appeal-detail{max-width:1100px}.appeal-detail>.card{display:grid;gap:14px;min-width:0}</style>
