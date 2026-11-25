-- PV-05 复验夹具（工程模拟，仅限 studyroom_java_test）
-- 先完成演示种子，再执行本脚本；随后启动应用或调用管理员限制列表以触发自动限制。
-- 本脚本按用户名/座位编号查找，不在数据库已有同 key 记录时重复插入。
BEGIN;

WITH fixture(username, seat_no, day_offset, start_time, end_time, status) AS (
  VALUES
    ('202600003','01-01',-3,'09:00','10:00','completed'),
    ('202600003','01-02',-2,'09:00','10:00','completed'),
    ('202600003','01-03',-1,'09:00','10:00','completed'),
    ('202600003','01-01', 1,'10:00','11:00','pending'),
    ('202600004','01-04',-2,'09:00','10:00','completed'),
    ('202600004','01-05',-1,'09:00','10:00','completed'),
    ('202600004','01-04', 1,'10:00','11:00','pending')
)
INSERT INTO reservations(user_id,seat_id,res_date,start_time,end_time,status,ended_at,termination_reason)
SELECT u.id,s.id,CURRENT_DATE + f.day_offset,f.start_time::time,f.end_time::time,f.status,
       CASE WHEN f.status='completed' THEN (CURRENT_DATE + f.day_offset) + f.end_time::time ELSE NULL END,
       CASE WHEN f.status='completed' THEN 'demo_completed' ELSE NULL END
FROM fixture f
JOIN users u ON u.username=f.username
JOIN seats s ON s.room_id=(SELECT id FROM rooms WHERE name='3F-D区') AND s.seat_no=f.seat_no
WHERE NOT EXISTS (
  SELECT 1 FROM reservations r
  WHERE r.user_id=u.id AND r.seat_id=s.id
    AND r.res_date=CURRENT_DATE + f.day_offset
    AND r.start_time=f.start_time::time
);

INSERT INTO violations(user_id,reservation_id,type,event_key,occurred_at,registered_at,status,reason,source)
SELECT u.id,r.id,'no_show','pv05-'||right(u.username,3)||'-'||r.id,
       r.res_date + TIME '10:00',LOCALTIMESTAMP,'active',
       'PV-05 工程模拟历史违规（'||u.username||'）','automatic'
FROM reservations r
JOIN users u ON u.id=r.user_id
JOIN seats s ON s.id=r.seat_id
WHERE u.username IN ('202600003','202600004')
  AND r.res_date < CURRENT_DATE
  AND r.status='completed'
  AND s.room_id=(SELECT id FROM rooms WHERE name='3F-D区')
  AND NOT EXISTS (
    SELECT 1 FROM violations v
    WHERE v.event_key='pv05-'||right(u.username,3)||'-'||r.id
  );

INSERT INTO notifications(user_id,type,title,content,violation_id,created_at)
SELECT v.user_id,'violation','违规记录提醒',
       'PV-05 工程模拟：违规#'||v.id||' 已登记，可在个人中心查看申诉条件。',
       v.id,v.registered_at
FROM violations v
WHERE v.user_id IN (SELECT id FROM users WHERE username IN ('202600003','202600004'))
  AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.violation_id=v.id);

COMMIT;
