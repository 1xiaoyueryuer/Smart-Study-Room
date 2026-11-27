<script setup>
defineProps({
  roomName: { type: String, required: true },
  seatNo: { type: String, required: true },
  date: { type: String, required: true },
  start: { type: String, required: true },
  end: { type: String, required: true },
  minutes: { type: Number, required: true }
})
</script>

<template>
  <div class="booking-confirmation">
    <dl class="booking-confirmation__details">
      <div class="booking-confirmation__room">
        <dt>自习室</dt>
        <dd>{{ roomName }}</dd>
      </div>
      <div class="booking-confirmation__seat">
        <dt>座位</dt>
        <dd>{{ seatNo }}</dd>
      </div>
      <div class="booking-confirmation__schedule">
        <dt>预约时段</dt>
        <dd>
          <time :datetime="date">{{ date }}</time>
          <div class="booking-confirmation__time">
            <strong>{{ start }}–{{ end }}</strong>
            <span>{{ minutes }} 分钟</span>
          </div>
        </dd>
      </div>
    </dl>
    <p class="booking-confirmation__reminder">
      请在预约开始后 <strong>15 分钟内</strong>扫码签到。
    </p>
  </div>
</template>

<style scoped>
.booking-confirmation {
  margin: 14px 0 20px;
}

.booking-confirmation__details {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  margin: 0;
}

.booking-confirmation__room,
.booking-confirmation__seat,
.booking-confirmation__schedule {
  padding: 12px 14px;
  border-radius: var(--r-lg);
}

.booking-confirmation__room,
.booking-confirmation__seat {
  border: 1px solid var(--border);
  background: var(--surface-2);
}

.booking-confirmation__details dt {
  color: var(--text-2);
  font-size: var(--fs-caption);
}

.booking-confirmation__details dd {
  margin: 4px 0 0;
  color: var(--text-1);
}

.booking-confirmation__room dd,
.booking-confirmation__seat dd {
  font-size: 17px;
  font-weight: 650;
  overflow-wrap: anywhere;
}

.booking-confirmation__seat dd,
.booking-confirmation__schedule dd {
  font-variant-numeric: tabular-nums;
}

.booking-confirmation__schedule {
  grid-column: 1 / -1;
  border: 1px solid var(--border-strong);
  background: var(--primary-weak);
}

.booking-confirmation__schedule time {
  font-size: var(--fs-body-sm);
}

.booking-confirmation__time {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px 10px;
  margin-top: 4px;
}

.booking-confirmation__time strong {
  font-size: clamp(20px, 6vw, 25px);
  line-height: 1.2;
}

.booking-confirmation__time span {
  padding: 3px 8px;
  background: var(--surface);
  border-radius: var(--r-full);
  color: var(--text-2);
  font-size: var(--fs-caption);
  white-space: nowrap;
}

.booking-confirmation__reminder {
  margin: 12px 0 0;
  color: var(--text-2);
  font-size: var(--fs-body-sm);
  line-height: 1.55;
}

.booking-confirmation__reminder strong {
  color: var(--text-1);
}
</style>
