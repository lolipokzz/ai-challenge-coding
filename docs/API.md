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
Даты расписания генерируются на выбранную неделю, оба студента имеют разные данные. Название: Разумист, вымышленный Университет Северного Горизонта.

## Изменения от 17 ноября 2026 года

- `GET /api/schedule?week=YYYY-MM-DD` возвращает `{items,weekStart,timeZone}`. Любая дата выбранной недели нормализуется до понедельника; без параметра используется текущая неделя по Москве. Неверная дата или год вне 2000–2100 даёт 400. `timeZone` равен `Europe/Moscow`. ID занятия — строка, уникальная для студента, недели и слота. Данные вымышленные, генерируются для выбранной недели.
- `GET /api/dashboard` содержит расписание текущей и следующей недель (30 занятий) и `timeZone`. Это позволяет показать ближайшую пару после выходных.
- `POST /api/requests/:id/demo-advance` возвращает `{item}` и переводит собственную заявку `submitted → processing → ready`, по одному этапу за вызов. Требует сессию и CSRF. Чужой ID — 404; `ready`/`cancelled` — 409. Изменение истории и создание уведомления о готовности выполняются в одной транзакции. Это явно обозначенная возможность вымышленного прототипа, не полномочие реального студента и не обработка сотрудником. Документ не выдаётся.
- У уведомления дополнительно возможны `dueDate` (YYYY-MM-DD по Москве), `actionLabel`, `requestType` (предзаполнение формы) и `requestId` (переход к конкретной заявке). `action` остаётся строкой. Категория `news` используется для объявления деканата. Сроки в демо-уведомлениях фиксируются при миграции и не продлеваются при перезапуске.
- Миграция `demo-news-deadlines-v1` добавляет объявление и дедлайн каждому демо-студенту один раз. Она не очищает БД, не меняет пользовательские заявки и не сбрасывает прочитанность уведомлений.

## Явный HTTPS origin

По умолчанию сервер остаётся локальным HTTP-прототипом. Для будущего доверенного обратного прокси предусмотрен флаг `-public-origin https://имя-хоста`: только HTTPS origin, без пути (допускается завершающий `/`), query, fragment и учётных данных. При его задании Origin мутаций сравнивается с этой настройкой, cookie сессии и её удаление получают Secure. Значения `Forwarded` и `X-Forwarded-*` не используются как источник доверия. Без настройки сохраняется локальная проверка Host/Origin и HTTP cookie. Сам флаг не включает TLS, не запускает прокси и не публикует проект; доступ к серверному порту в будущем должен быть ограничен доверенным прокси. Запросы без Origin по-прежнему допускаются для API-клиентов, но для мутаций после входа обязательно требуется CSRF-токен.

## Расписание преподавателей

Авторизованный `GET /api/schedule?week=YYYY-MM-DD&teacher=teacher-1` возвращает общедоступные внутри демо занятия преподавателя по двум вымышленным группам. Без teacher возвращается расписание группы текущего студента. Неизвестный teacher → 404; правила проверки недели прежние.

Ответ дополнен `teacherId` (пустая строка для своей группы), `teachers: [{id,name,position}]`. Каждая пара содержит `teacherId`, `teacherPosition`, `group`. Личные записи других студентов не возвращаются. Оба представления используют один генератор; занятия второй группы проходят после первой, без одновременных назначений преподавателя.

`GET /api/schedule?week=YYYY-MM-DD&group=ИС-23-1` выбирает расписание конкретной демонстрационной группы (значение URL-кодируется). Ответ дополнен `groups` и `groupId`; в режиме преподавателя groupId пустой. Передача group и teacher одновременно → 400, неизвестная группа → 404. Без обоих фильтров возвращается своя группа. Чужие оценки, профили и заявки по-прежнему недоступны.
