# API v1
Все ответы JSON, ошибки {"error":"Сообщение"}. Cookie session HttpOnly SameSite=Lax. Мутации проверяют Origin и X-CSRF-Token (кроме login); токен возвращается login/me. Все маршруты /api/ требуют входа кроме login.
POST /api/login {login,password} -> {user,csrfToken}
GET /api/me -> {user,csrfToken}
POST /api/logout -> {ok:true}
GET /api/dashboard -> {schedule:[],grades:[],requests:[],notifications:[]}
GET /api/schedule -> {items:[]}
GET /api/grades -> {items:[]}
GET /api/requests -> {items:[]}
POST /api/requests {type,comment} -> 201 {item}
GET /api/requests/:id -> {item} (404 for other owner)
POST /api/requests/:id/cancel -> {item}
GET /api/notifications -> {items:[]}
POST /api/notifications/:id/read -> {ok:true}
user: {id,name,faculty,program,year,group,email,studentNumber}
schedule item: {id,date,start,end,subject,type,room,teacher,changed,changeNote}
grades item: {id,subject,teacher,score,maxScore,status,examDate,assessment} status: passed|in_progress|attention; assessment: Экзамен|Зачёт
request item: {id,type,comment,status,createdAt,updatedAt,history:[{status,date,note}]} status: submitted|processing|ready|cancelled
notification item: {id,title,body,category,createdAt,read,action} action: schedule|requests|grades|null
Типы заявок: Справка об обучении; Справка о стипендии; Заявление на материальную помощь; Обращение в деканат.
Демо-вход: alina / Campus2026! и mark / Campus2026! — это публичные данные вымышленных аккаунтов.
Даты расписания генерируются на текущую неделю, оба студента имеют разные данные. Название: Разумист, вымышленный Университет Северного Горизонта.
