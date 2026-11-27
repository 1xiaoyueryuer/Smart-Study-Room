<script setup>
import { reactive, ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { message } from '../components/ui/feedback'
import { login, updateProfile, changePassword } from '../api/auth'
import { useAuthStore } from '../stores/auth'
import AppIcon from '../components/AppIcon.vue'
import SButton from '../components/ui/SButton.vue'
import SInput from '../components/ui/SInput.vue'
import { SYSTEM_NAME, SYSTEM_NAME_ZH } from '../config/branding'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const loading = ref(false)
const loginError = ref('')
const setupVisible = ref(false)
const setupSaving = ref(false)
const setupError = ref('')
const showSetup = computed(() => setupVisible.value || !!auth.user?.must_change_password)

const loginForm = reactive({ username: '202600001', password: '123456' })
const setupForm = reactive({ current_password: '', phone: '', email: '', new_password: '', confirm_password: '' })

async function onLogin() {
  if (loading.value) return
  if (!loginForm.username || !loginForm.password) {
    message.warning('请输入学号与密码')
    return
  }
  loginError.value = ''
  loading.value = true
  try {
    const resp = await login(loginForm)
    auth.setLogin(resp.data)
    if (resp.data.user?.must_change_password) {
      setupForm.current_password = loginForm.password
      setupForm.phone = resp.data.user.phone || ''
      setupForm.email = resp.data.user.email || ''
      setupVisible.value = true
      setupError.value = ''
      message.warning('初次使用请先设置联系电话并修改登录密码')
      return
    }
    message.success('登录成功')
    router.push(route.query.redirect || '/')
  } catch (error) {
    loginError.value = error.message
  } finally {
    loading.value = false
  }
}

function cancelSetup() {
  auth.logout()
  setupVisible.value = false
  setupError.value = ''
  router.replace('/login')
}

async function onFirstSetup() {  if (setupSaving.value) return
  setupError.value = ''
  const current = setupForm.current_password
  const phone = setupForm.phone.trim()
  const newPassword = setupForm.new_password
  const confirm = setupForm.confirm_password
  if (!current) { setupError.value = '请输入当前密码'; return }
  if (!phone) { setupError.value = '联系电话必填'; return }
  if (phone.length > 30) { setupError.value = '联系电话不超过30个字符'; return }
  if (newPassword.length < 6 || newPassword.length > 64) { setupError.value = '新密码须为6至64个字符'; return }
  if (newPassword !== confirm) { setupError.value = '两次输入的新密码不一致'; return }
  if (newPassword === current) { setupError.value = '新密码不能与当前密码相同'; return }
  setupSaving.value = true
  try {
    await updateProfile({ phone, email: setupForm.email.trim() })
    const resp = await changePassword({ current_password: current, new_password: newPassword })
    auth.setUser({ ...resp.data, must_change_password: false })
    setupVisible.value = false
    message.success('设置完成，正在进入系统')
    router.push(route.query.redirect || auth.roleHomePath)
  } catch (error) {
    setupError.value = error.message
  } finally {
    setupSaving.value = false
  }
}

const features = [
  { icon: 'seat', title: '可视化选座' },
  { icon: 'booking', title: '分钟预约' },
  { icon: 'check', title: '扫码签到' },
  { icon: 'reservations', title: '本人记录' }
]
</script>

<template>
  <div v-reveal class="auth-shell">
    <div class="auth-photo" aria-hidden="true"></div>

    <header class="auth-brand">
      <div class="brand-mark"><AppIcon name="book" :size="26" /></div>
      <div class="brand-copy">
        <div class="brand-name">{{ SYSTEM_NAME_ZH }}</div>
        <div class="brand-sub">{{ SYSTEM_NAME }}</div>
      </div>
    </header>

    <main class="auth-main">
      <section v-if="!showSetup" class="auth-card">
        <figure class="auth-illustration">
          <img src="/images/login-bear.png?v=1" alt="一只小熊坐着安静看书" />
        </figure>
        <div class="auth-form-col">
          <header class="auth-heading"><h2>欢迎回来</h2><p>为今天的学习，留一个好位置。</p></header>
          <form class="auth-form" @submit.prevent="onLogin">
            <p v-if="loginError" role="alert" class="form-error">{{ loginError }}</p>
            <div class="form-field">
              <label class="form-label" for="login-username">账号</label>
              <SInput id="login-username" v-model="loginForm.username" size="lg" placeholder="请输入校园账号" autocomplete="username" />
            </div>
            <div class="form-field">
              <label class="form-label" for="login-password">密码</label>
              <SInput
                id="login-password"
                v-model="loginForm.password"
                type="password"
                size="lg"
                placeholder="请输入密码"
                show-password
                autocomplete="current-password"
              />
            </div>
            <SButton type="submit" variant="primary" size="lg" block :loading="loading">
              登录
            </SButton>
          </form>

          <div class="auth-tips">
            <p>校园账号由管理员维护，暂不支持自助注册。</p>
            <p>信息安全：请妥善保管账号安全</p>
            <p class="auth-tips-demo">演示学生 202600001 / 123456 · 管理员 202630001 / admin123</p>
          </div>
        </div>
      </section>

      <section v-else class="auth-card auth-card--solo">
        <div class="auth-form-col">
          <header class="auth-heading"><h2>首次使用设置</h2><p>请设置联系电话并修改初始登录密码，完成后才能进入系统。</p></header>
          <form class="auth-form" @submit.prevent="onFirstSetup">
            <p v-if="setupError" role="alert" class="form-error">{{ setupError }}</p>
            <div class="form-field">
              <label class="form-label" for="setup-current">当前密码 <span class="req">*</span></label>
              <SInput id="setup-current" v-model="setupForm.current_password" type="password" size="lg" placeholder="当前登录密码" show-password autocomplete="current-password" />
            </div>
            <div class="form-field">
              <label class="form-label" for="setup-phone">联系电话 <span class="req">*</span></label>
              <SInput id="setup-phone" v-model="setupForm.phone" type="tel" size="lg" maxlength="30" placeholder="请输入联系电话" autocomplete="tel" />
            </div>
            <div class="form-field">
              <label class="form-label" for="setup-new">新密码 <span class="req">*</span></label>
              <SInput id="setup-new" v-model="setupForm.new_password" type="password" size="lg" placeholder="6至64个字符" show-password autocomplete="new-password" />
            </div>
            <div class="form-field">
              <label class="form-label" for="setup-confirm">确认新密码 <span class="req">*</span></label>
              <SInput id="setup-confirm" v-model="setupForm.confirm_password" type="password" size="lg" placeholder="再次输入新密码" show-password autocomplete="new-password" />
            </div>
            <div class="form-field">
              <label class="form-label" for="setup-email">邮箱（选填）</label>
              <SInput id="setup-email" v-model="setupForm.email" type="email" size="lg" maxlength="254" placeholder="选填" autocomplete="email" />
            </div>
            <SButton type="submit" variant="primary" size="lg" block :loading="setupSaving">
              完成设置并进入系统
            </SButton>
          </form>
          <p class="auth-tips"><button type="button" class="setup-logout" @click="cancelSetup">退出登录</button></p>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* 登录页固定浅色外观：照片背景 + 米白渐层卡片，不随深色主题翻转 */
.auth-shell {
  --surface: #fbfefd;
  --surface-2: #f3faf8;
  --surface-3: #eaf4f1;
  --surface-hover: #eef8f5;
  --border: #d9e9e3;
  --border-strong: #c3dbd3;
  --hairline: #e6f1ee;
  --text-1: #23372d;
  --text-2: #4f5f54;
  --text-3: #7b877d;
  --text-4: #a3ab9f;
  --primary: #52966d;
  --primary-hover: #478a62;
  --primary-active: #3f7b57;
  --primary-weak: #e4efe8;
  --primary-faint: #f2f7f3;
  --primary-ring: rgba(82, 150, 109, .25);
  --ring: 0 0 0 3px var(--primary-ring);
  --red: #b9544b;

  position: relative;
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 104px 28px 52px;
  background: #f2efe6;
  overflow: hidden;
}

/* 背景照片：参考图，50% 透明，轻微虚化让卡片浮起来 */
.auth-photo {
  position: absolute;
  inset: -8px;
  background: url('/images/login-bg.jpg') center / cover no-repeat;
  opacity: .5;
  filter: blur(3px) saturate(1.04);
  pointer-events: none;
}

/* 左上角品牌：沿用现有书本站标，名称改为黑色 */
.auth-brand {
  position: absolute;
  top: 42px;
  left: 52px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 14px;
}
.brand-mark {
  width: 54px;
  height: 54px;
  border-radius: 14px;
  background: #2f5d46;
  color: #fff;
  display: grid;
  place-items: center;
  box-shadow: 0 6px 16px rgba(23, 43, 32, .3);
}
.brand-name {
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 700;
  color: #111;
  letter-spacing: .01em;
}
.brand-sub {
  margin-top: 2px;
  font-size: 10.5px;
  font-weight: 500;
  color: #111;
  letter-spacing: .16em;
  text-transform: uppercase;
}

.auth-main {
  position: relative;
  z-index: 1;
  width: 100%;
  display: grid;
  place-items: center;
}

/* 卡片：从右下角到左上角由深到浅的渐层 */
.auth-card {
  width: min(1040px, 94vw);
  display: grid;
  grid-template-columns: minmax(0, 1.02fr) minmax(0, .98fr);
  align-items: stretch;
  border-radius: 32px;
  background: linear-gradient(to top left, #dcd4c5 0%, #efece4 52%, #f8f6f0 100%);
  box-shadow: 0 32px 80px rgba(38, 32, 20, .3);
  overflow: hidden;
}

/* 左半：小熊插画；中间分界线保持很淡 */
.auth-illustration {
  margin: 0;
  display: grid;
  place-items: center;
  padding: 12px 8px 10px;
  border-right: 1px solid rgba(92, 80, 56, .06);
}
.auth-illustration img {
  display: block;
  width: 100%;
  max-width: 520px;
  max-height: min(640px, 72vh);
  object-fit: contain;
}

/* 右半：登录表单 */
.auth-form-col {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  padding: 56px 58px;
}
.auth-heading h2 {
  font-family: var(--font-display);
  font-size: clamp(30px, 2.6vw, 38px);
  font-weight: 600;
  color: #1e2a26;
  text-align: center;
}
.auth-heading p {
  margin-top: 12px;
  font-size: 14.5px;
  color: #5f5b53;
  text-align: center;
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 34px;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.form-label {
  font-size: 13px;
  font-weight: 600;
  color: #4a463e;
  letter-spacing: .02em;
}
.req { color: var(--red); margin-left: 2px; }
.form-error {
  margin: 0;
  color: var(--red);
  font-size: 13px;
  line-height: 1.5;
}
.auth-form .s-btn {
  margin-top: 6px;
  height: 52px;
  font-size: 16px;
  border-radius: 12px;
}
.auth-tips {
  margin-top: 22px;
  display: grid;
  gap: 8px;
  text-align: center;
  font-size: 12px;
  color: #8b8579;
  line-height: 1.6;
}
.auth-tips p { margin: 0; }
.auth-tips-demo { color: #a39c8e; font-size: 11.5px; }
.setup-logout {
  all: unset;
  color: #7b6f58;
  font-size: var(--fs-caption);
  cursor: pointer;
}
.setup-logout:hover { text-decoration: underline; }

/* 首次设置：单列卡片 */
.auth-card--solo {
  width: min(560px, 94vw);
  grid-template-columns: 1fr;
}

@media (max-width: 900px) {
  .auth-shell { padding: 92px 18px 40px; }
  .auth-brand { top: 22px; left: 22px; gap: 10px; }
  .brand-mark { width: 44px; height: 44px; border-radius: 12px; }
  .brand-name { font-size: 17px; }
  .brand-sub { font-size: 9px; letter-spacing: .12em; }
  .auth-card {
    width: min(480px, 100%);
    grid-template-columns: 1fr;
    border-radius: 24px;
  }
  .auth-illustration { display: none; }
  .auth-form-col { padding: 34px 24px 30px; }
}

@media (max-width: 480px) {
  .auth-form-col { padding: 28px 18px 24px; }
  .auth-shell { padding-top: 84px; }
}
</style>
