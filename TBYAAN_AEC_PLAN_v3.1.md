# TBYAAN MCP Hub: الخطة الموحدة (الإصدار 3.1)

دمج خطة المراحل (Stage 0–8) مع معمارية v2.2. القرارات الخمسة اتحسمت على الخيارات المرشّحة (أ في كل قرار). v3.1 يدمج مراجعة الـ agent: ترتيب مراحل جديد، تسليم بـ tarball، backup اختياري، وUI بشاشتين.

> **تنبيه مهم:** مراجع الـ agent أكد إنه راجع كود DSH الفعلي لنقاط الاتصال (`ctx.mcpManager`، `ctx.commands`، `ctx.configEditor`، `tools/pre-execute`، `dsh.bundle.patch`...)، وأنا ما أقدرش أتحقق من ده بنفسي. اللي لسه غير متحقق وتغطيه المرحلة 0 (يوم واحد): (1) build الـ client خارج المونوريبو، (2) تحميل pack بالاسم وقت التشغيل، (3) قدرات الـ backup لكل MCP، (4) سلوك `ask` بدون approval service، (5) الـ discovery على جهازك. أي نسبة أو مدة في الخطة تقدير مبدئي وليس قياسًا.

## 1. الفكرة في سطرين

حزمة منفصلة تتركّب في أي مشروع DSH بسطر واحد، وبدونها المشروع يشتغل كما هو. النواة عامة (أي MCP server)، والـ AEC مجرد "pack" بيانات فوقها، والأمان مبني من أول يوم.

## 2. القرارات المعتمدة

| # | القرار | الاختيار | السبب |
| --- | --- | --- | --- |
| 1 | ترتيب الـ UI | أوامر الأول، UI بشاشتين (Modules وDoctor) في مرحلة متأخرة | الأدوات تشتغل من الشات حتى لو الـ UI اتأخر |
| 2 | الاكتشاف | تلقائي + تأكيد منك قبل التطبيق | مسار غلط لا يتشغّل أبدًا بدون موافقة |
| 3 | توزيع الحزمة | tarball جاهز (registry خاص لاحقًا) بدل `link:` | الزميل لا يحتاج Node أو pnpm أو build، وlink: للتطوير فقط |
| 4 | تسطيب الـ servers | handler لكل server داخل `setup` + `doctor` يبلّغ بالناقص | الـ 6 عندهم طرق تثبيت مختلفة، فسكريبت عام وهم |
| 5 | المفاتيح | `credentials-local` الآن، Keychain لاحقًا | Keychain لا يحل مشكلة العزل عن الـ agent أصلًا |

## 3. المبادئ الحاكمة

1. **حزمة واحدة منفصلة:** صفر تعديل في upstream. لو اضطررنا لتعديل، يتحفظ كملف `patches/*.patch` موثّق.
2. **النية ≠ الحقيقة:** ما قرره المستخدم (enabled/profile) في config المشروع، وما اتكشف على الجهاز (مسارات/عمليات) في home. ده اللي يخلّي الإعداد قابل للمشاركة.
3. **المنع في التنفيذ:** `tools.restrict` للعرض فقط، و`tools/pre-execute` هو المنع الحقيقي.
4. **Read-only افتراضي:** أي كتابة تحتاج تفعيل + تأكيد.
5. **صفر أسرار** في الكود أو الـ config أو الـ logs أو git.
6. **الأبسط عند التردد:** stdio فقط، أداة واحدة للموديل، أوامر قبل UI.
7. **معيار النجاح الحقيقي:** التثبيت في profile تاني نضيف على جهاز زميل، من غير أي تعديل كود.

## 4. المعمارية: ثلاث طبقات

```
@tbyaan/mcp-hub         النواة العامة: registry + supervisor + policy + audit + أوامر + UI
@tbyaan/pack-aec        بيانات فقط: catalog لـ 6 MCPs (Revit, Navis, Rhino, AutoCAD, Civil3D, SketchUp)
@tbyaan/pack-<اسم>      مستقبلًا: packs جديدة بدون لمس النواة
```

- **النواة لا تعرف Revit.** كل معرفة بالبرامج موجودة في الـ pack.
- **إضافة MCP جديد = تعريف واحد في catalog**، بدون كود.
- **Revit:** `rvt-mcp` هو خادم Revit في هذا الإصدار.

### هيكل الحزمة

```
@tbyaan/mcp-hub
├── package.json            (dsh.bundle.patch + dsh.client + engines.dsh + peers)
├── cordis.patch.yml        (صف واحد = host + UI + أوامر)
├── AGENTS.md               (خريطة الملفات وقواعد التعديل لأي AI agent)
├── UPGRADE_PROMPT.md       (prompt جاهز بعد أي تحديث upstream)
├── INTEGRATION.md          (كل نقطة اتصال بـ upstream)
├── servers.lock            (إصدارات الـ servers: مسجّل + تحذير فقط)
├── scripts/setup/          (handler لكل server: rvt, navis, rhino, autocad, sketchup, civil3d)
├── patches/                (لو في تعديل upstream لازم، منفصل وموثق)
├── src/
│   ├── index.ts            Config schema + wiring + حماية التحميل المزدوج
│   ├── registry.ts         تحميل packs (بدون manifest في v1)
│   ├── discovery.ts        اكتشاف مسارات + عمليات (atomic write + قفل)
│   ├── supervisor.ts       register/unregister/probe + app gate
│   ├── commands.ts         /aec و /mcp
│   ├── control-tool.ts     aec_control
│   ├── policy.ts           tools/pre-execute
│   ├── audit.ts            tools/result إلى JSONL
│   ├── backup.ts           اختياري: يُبنى فقط للـ packs اللي تعلن دعمه
│   ├── remote.ts           خدمة للـ UI
│   ├── types.ts            types آمنة للـ client
│   └── client/             صفحة الـ UI (شاشتان في v1)
└── tests/
    ├── unit/
    └── composition/        loader smoke بـ cordis.yml حقيقي
```

### التركيب

للزملاء: Plugins ثم Install من ملف الـ tarball الجاهز. للتطوير فقط: `link:<path>`. أو يدويًا بإضافة الصف في `cordis.patch.yml`:

```yaml
- insert:
    - id: mcp-hub
      name: '@tbyaan/mcp-hub'
      config:
        packs: ['@tbyaan/pack-aec']
        discovery: { applyMode: confirm }
        defaults: { profile: coordination, writeMode: deny, maxVisibleTools: 120 }
```

## 5. النية والحقيقة

**النية** (في profile المشروع، قابلة للمشاركة، بدون مسارات جهاز): أي modules مفعّلة، `writeMode` لكل module، الـ profiles.

```jsonc
{
  "modules": { "rvt": { "enabled": true, "writeMode": "deny" }, "navis": { "enabled": false } },
  "profiles": {
    "coordination": { "navis": ["read"], "rvt": ["read"] },
    "modeling":     { "rvt": ["read", "write"], "rhino": ["read", "write"] }
  },
  "defaults": { "profile": "coordination", "writeMode": "deny", "maxVisibleTools": 120, "pollMs": 20000 }
}
```

**الحقيقة** (في `~/.dsh/tbyaan-hub/discovered.json`، خاصة بالجهاز): مسارات الـ executables، أسماء العمليات، مستوى الثقة (`high | medium | low | none`) والدليل.

## 6. الـ Catalog (الـ Manifest وثيقة فقط في v1)

كل MCP يتعرّف بمدخل واحد: الاسم، الـ vendor، أسماء عمليات التطبيق، مسارات التثبيت المعروفة، أمر التشغيل (stdio)، الأوضاع (modes)، وهل يحتاج التطبيق مفتوحًا، وتلميحات تصنيف الأدوات (write / destructive).

- مصادر التعريف في v1: الـ pack المدمج، أو `catalog.extra` في الـ config.
- **الـ manifest (`mcp.manifest.json`) مؤجل:** لا أحد يحتاجه الآن لمشاريع خارجية. صيغته الأدنى موثقة فقط: `name`, `icon`, `command`, `args`, `runtime`, `version`, `description`.

## 7. الاكتشاف (zero-config مع تأكيد)

`discover()` قراءة فقط ولا يسجّل أي server:

1. **التطبيقات:** العمليات الشغالة + مفاتيح Uninstall في الريجستري + مجلدات Autodesk/Trimble/McNeel المعروفة.
2. **الـ MCP نفسه:** مجلدات التثبيت المعروفة (أعلى نسخة)، ثم `npm ls -g` / `pip show` / `where`، ثم `roots` من الـ config.
3. **المخرجات:** `command` + `confidence` + `evidence` لكل module.
4. **التطبيق:** جدول تأكيد، ولا يُكتب شيء إلا بعد موافقتك. الكتابة في discovered.json تتم atomic مع قفل، عشان نسختين من التطبيق ما يتلفوش الملف.

**حدود صريحة:** Civil3D وSketchUp غالبًا مبنيين من السورس، فمسارهم من `roots` أو override يدوي. وAutoCAD وCivil3D يشتركان في `acad.exe` فنفرّق بينهم بـ `pathContains`.

**`doctor`** يفحص: الـ command محسوم؟ التطبيق موجود؟ البورتات الداخلية متعارضة (Civil3D :8080، SketchUp :9876)؟ خدمة الـ approval موجودة (لازمة لـ `ask`)؟ إصدار الـ pack؟ هل إصدارات الـ servers مختلفة عن `servers.lock`؟

## 8. الـ Supervisor

- `register(name, entry)` يرجع disposer، وكل شيء يتنظف عند الإيقاف (لا processes يتيمة).
- الحالات الأربع: `disabled` / `app_not_running` / `connected` / `error`.
- `app.gate` يبقى `off` حتى تملأ الـ discovery أسماء العمليات.
- `probe` = register مؤقت، ثم انتظار `connected` أو timeout، ثم dispose.
- Polling كل 20 ثانية بـ query واحد، ويتوقف لو مفيش module فيه gate مفعّل.
- multi-instance مؤجل صراحةً. خدمة التحميل ترفض التحميل المزدوج (صف مكرر أو profileين في نفس الـ host) برسالة واضحة بدل duplicate error من tools.register. وtools.restrict يُطبَّق عند tools/change بعد الاتصال، مع معالجة الـ exception لو التطبيق اتفتح في توقيت غلط.

## 9. التحكم

| الأمر | الوظيفة |
| --- | --- |
| `/aec` أو `/mcp` | ملخص الحالة |
| `/aec discover` | اكتشاف وجدول تأكيد |
| `/aec enable <module>` / `disable` | توجل وحفظ |
| `/aec probe <module>` | probe نظيف |
| `/aec doctor` | تشخيص كامل |
| `/aec profile <name>` | تبديل الـ profile |
| `/aec audit [n]` | آخر n عمليات write |

**أداة الموديل الوحيدة:** `aec_control({ action, module? })` بـ actions: `status | list | enable | disable | probe | doctor | discover`. `status/list/doctor` آمنة، والباقي يمر على `pre-execute` ويحتاج موافقة. **لا يُكشف `writeMode` للموديل أبدًا**؛ تغييره من الـ UI أو الأمر فقط.

## 10. الأمان

### سياسة الكتابة

`writeMode`: `deny` (افتراضي) | `confirm` | `allow` لكل module، وتُنفَّذ في `tools/pre-execute`:

- `write` + `deny` يعني رفض بسبب واضح.
- `write` + `confirm` يعني `ask`، وبدون approval service يكون رفضًا.
- `destructive` يعني `ask` دائمًا، حتى في `allow`.

### نسخة احتياطية قبل الـ write: اختيارية لكل pack

مفيش API موحّد للنسخ الاحتياطي، والنسخة نفسها عملية كتابة فممكن تعمل recursion في الـ policy. عشان كده الـ backup قدرة اختيارية يعلنها كل pack لكل server. لو مدعومة، يطلبها الـ hub قبل أول كتابة ويسجّل مسارها في الـ audit، وتُستثنى من الـ policy بقائمة بيضاء ضيقة. لو مش مدعومة، الوضع الافتراضي `confirm` مع تحذير صريح إن مفيش نسخة احتياطية. معنى "نسخة" لكل برنامج قرار هندسي (AEC) مش قرار كود، وهو بند مفتوح في قسم 17.

### Audit

ملفات JSONL في `~/.dsh/tbyaan-hub/audit/YYYY-MM.jsonl`: الوقت، session، agent، module، tool، قرار السياسة، النتيجة، المدة. مع redaction للأسرار.

### الأسرار

- `credentials-local` (ملف بصلاحيات owner-only) عبر `${credential:...}` فقط.
- **حد معروف:** هذا لا يعزل المفاتيح عن الـ agent لأنه نفس المستخدم. لا نعد بغير ذلك.
- المزودون (Anthropic / OpenAI / DeepSeek / Ollama / vLLM / LM Studio) عبر config على `llm-pi-ai` فقط، بدون provider package.
- ممنوع: Sign-In / cookies / session tokens.

## 11. الـ UI

- **أيقونة MCP دايمة** في الـ sidebar، تفتح الـ hub (صفحة في `main` slot).
- **الشاشات:** في v1 شاشتان فقط: Modules (جدول + toggle + probe) وDoctor. شاشات Catalog وProfiles وAudit في إصدار لاحق، ومتاحة من الأوامر في الأثناء.
- أي تغيير `writeMode` أو `enable` يحتاج تأكيدًا داخل الصفحة ويمر على نفس الـ policy.
- النصوص في locale dictionary (إنجليزي أساسي).
- **قاعدة:** كل شاشة لها أمر مقابل يُبنى قبلها، فالـ UI لا يكون نقطة فشل وحيدة.
- **تحذير:** هذه أغلى وأخطر مرحلة (تقدير 8–15 يوم). ابدأ بنسخ build config من ui-plugin-manager حرفيًا، ومفيش client جاهز يرسم الـ settings.

## 12. الجاهزية للتحديثات وللـ vibe coding

| الأداة | وظيفتها |
| --- | --- |
| `INTEGRATION.md` | جدول بكل نقطة اتصال بـ upstream (API + الملف + الاختبار المقابل) |
| `verify` | أمر يختبر كل نقاط الاتصال ويقول بالظبط أيها اتكسر |
| `patches/` | أي تعديل upstream لازم يكون ملف patch منفصل مع سبب وتاريخ ونسخة upstream |
| `UPGRADE_PROMPT.md` | prompt جاهز للـ agent بعد أي تحديث: شغّل verify، اقرأ الـ changelog، أصلح نقاط الاتصال المكسورة فقط، لا تلمس المنطق |
| `AGENTS.md` | خريطة الملفات، القواعد، وقائمة "ممنوع" (لا أسرار، لا تعديل في `policy.ts` بدون اختبار، لا تعطيل `deny`) |
| الاختبارات | شبكة الأمان: unit + composition smoke، وأي تعديل بدون اختبار يُرفض |

**سير العمل بعد أي تحديث upstream:** سحب التحديث، ثم `verify`، ثم لو فشل شيء نعطي `UPGRADE_PROMPT.md` للـ agent، ثم `verify` مرة أخرى، ثم commit.

## 13. التسليم للزملاء (مطلب أساسي)

1. الزميل ياخد ملف tarball جاهز ومبني، بدون Node أو pnpm أو build.
2. Plugins ثم Install من الملف (أو إضافة الصف يدويًا).
3. `setup`: handler لكل server يركّبه أو يوجّهك لطريقة تثبيته الصحيحة ويبلّغ بالناقص.
4. `/aec doctor` للتشخيص.
5. `/aec discover` وتأكيد الجدول.

**الهدف:** زميل على جهاز نضيف يركّب الحزمة نفسها في دقائق. تسطيب الـ 6 servers يعتمد على كل واحد منها، فلا نعد بزمن محدد ونقيسه في QA. وservers.lock مسجّل + تحذير مش إلزامي لأن إصدارات بعض الـ servers تتغير تلقائيًا. لو الفريق كبر ننتقل لـ registry خاص.

**طرق تثبيت الـ servers (من مراجعة الـ agent):**

| Server | طريقة التثبيت |
| --- | --- |
| rvt | مثبّت Bimwright (بيحدّث نفسه) |
| navis | ملف `.bundle` |
| rhino / autocad | pip |
| sketchup | npm أو `.mcpb` |
| civil3d | من السورس |

## 14. المراحل (مرحلة واحدة كل مرة، بموافقتك)

**قواعد كل مرحلة (تُلصق في أول كل prompt):**

1. استكشف أولًا، ثم اقترح خطة قصيرة، ثم انتظر موافقتي قبل تغيير أي كود.
2. اشتغل بخطوات صغيرة، وبعد كل خطوة قل ما تغيّر وكيف أختبره.
3. لا تكسر أي ميزة موجودة. تعديلات minimal ومنظمة.
4. طابق لغة وأسلوب الكود الموجود.
5. لو في شيء غير واضح، اسألني ولا تخمّن.

### المرحلة 0: Audit (بدون أي كود) ✅

- **النتيجة:** التقرير الكامل في `TBYAAN-MCP-HUB\docs\PHASE0-AUDIT.md`، والتصحيحات مسجّلة في 19.4 و19.5 و19.8.

- تأكيد 5 نقاط فقط (يوم واحد): build الـ client خارج المونوريبو (tsdown + externals + combo/assets)، تحميل pack بالاسم وقت التشغيل وما يحصل لو مش متسطّب، قدرات الـ backup لكل MCP، سلوك `ask` بدون approval service، وdiscovery على جهازك (ريجستري/WMI/صلاحيات).
- باقي نقاط الاتصال (`mcpManager`، `commands`، `configEditor`، `tools/pre-execute`، `dsh.bundle.patch`...) متحقق منها بحسب مراجعة الـ agent، وتكفيها نظرة سريعة.
- تحديد مكان مشاريع الـ servers وكل runtime تحتاجه.
- **القبول:** تقرير قصير + أسئلتك اتجاوبت. أي بند اتضح إنه غلط يتصحح قبل المتابعة.

### المرحلة 1: الهيكل والتحميل ✅

- **النتيجة:** الحزمة + الصف + registry + حماية التحميل المزدوج + profile `tbyaan-test` جاهزين. الدليل والأوامر في `TBYAAN-MCP-HUB\docs\PHASE1-STATUS.md`.

- package + bundle patch + registry بسيط (packs فقط) + أول صف يتحمّل، مع حماية من التحميل المزدوج.
- **القبول:** الحزمة تتثبت بـ `link:` في profile تاني نضيف وتظهر في Plugins، بدون كود في المشروع المضيف.

### المرحلة 2: Supervisor

- register/disposer، الحالات الأربع، app gate، polling، probe.
- **القبول:** `rvt` و`navis` يشتغلوا ويقفوا live بدون restart، والحالات صحيحة.

### المرحلة 3: Packs والاكتشاف

- `pack-aec` (6 modules)، و`discovery.ts` (قبل الأوامر لأن `/aec discover` يعتمد عليه)، و`doctor`، وعرض الـ confidence.
- **القبول:** على جهازك، 5 من 6 على الأقل `high`، والباقي `medium/low` مع سبب واضح.

### المرحلة 4: الأوامر

- `/aec` كاملة، و`/mcp` العام، و`aec_control`، وremote API.
- **القبول:** كل عملية متاحة من الشات بدون تكرار في session log.

### المرحلة 5: الأمان (الـ backup اختياري لكل pack)

- policy (`deny`/`ask`)، وaudit JSONL، و`/aec audit`، والـ backup فقط للـ packs اللي تعلن دعمه. مع مراجعة أمنية مخصصة لمسارات الـ bypass.
- **القبول:** write مرفوض في `deny`، و`confirm` يطلب موافقة، وكل write في الـ audit.

### المرحلة 6: الـ UI

- أيقونة MCP دايمة + شاشتان (Modules وDoctor) + i18n، مع نسخ build config من ui-plugin-manager حرفيًا.
- **القبول:** توجل وحالة وprobe من الصفحة بدون terminal.

### المرحلة 7: التسليم

- tarball جاهز + `setup` (handler لكل server) + `servers.lock` (مسجّل + تحذير) + `INTEGRATION.md` + `AGENTS.md` + `UPGRADE_PROMPT.md` + `verify`.
- **القبول:** زميل يركّب الحزمة من الـ tarball على جهاز نضيف بدون Node أو pnpm أو build، ويشغّل `doctor` و`discover`. تسطيب الـ servers تتقاس ولا نعد بزمن.

### المرحلة 8: نقاط امتداد الـ Agents (واجهات فقط)

- وثيقة قصيرة فقط، بدون كود: أين يتوصل `ServerHandle` وAgent interface (role، system prompt، allowed tools، memory) وكيف يستعملان نفس الواجهة للأوامر والـ UI. لا `handle.ts` ولا manifest في v1.
- **ممنوع بناء نظام الـ agents.**
- **المرحلة اللاحقة (agents + ملف guidance لكل server) مقفولة حتى تعطي إذنًا صريحًا.**
- **الحالة:** اكتملت بوثيقة `TBYAAN-MCP-HUB/docs/PHASE8-STATUS.md`؛ الواجهات المذكورة وصف لنقاط الربط الحالية والمستقبلية فقط.

### المرحلة 9: QA

- تثبيت نضيف، إضافة server، حذف server، server بيقع، module معطّل، restart، وتحديث upstream تجريبي.
- **القبول:** `verify` بصفر أخطاء + loader smoke + نجاح الخطوات كلها على جهاز زميل.
- **الحالة:** الفحوص والسيناريوهات المحلية موثقة في `TBYAAN-MCP-HUB/docs/PHASE9-STATUS.md`؛ قبول جهاز الزميل ما زال يحتاج تنفيذًا على جهازه.

### تقدير المدة (مبدئي من مراجعة الـ agent)

متفائل 7 أسابيع، واقعي 11، متشائم 16 (مطوّر واحد، 6 ساعات يوميًا، Windows). لو الشغل مسائي (3 ساعات) اضرب × 1.8. أخطر البنود: الـ UI (8–15 يوم)، والـ discovery (5–7)، والـ backup (3–5)، والـ setup (3–5). الأرقام تتعدّل بعد المرحلة 0.

## 15. المخاطر

| الخطر | الحل |
| --- | --- |
| وثيقة v2.2 فيها 5 بنود فقط غير متحقق منها (المرحلة 0) | المرحلة 0 تؤكدها قبل أي كود |
| الـ client build صعب | يتأجل للمرحلة 6، شاشتان فقط في v1، ونسخ build config من ui-plugin-manager حرفيًا |
| discovery يغلط مسار | `confidence` + تأكيد + override يدوي |
| Civil3D/AutoCAD نفس `acad.exe` | `pathContains` ومسار التنفيذ |
| الحزمة تشتغل في profile واحد فقط | معيار قبول صريح: profile تاني + جهاز زميل |
| كسر توافق DSH بعد تحديث | `engines.dsh` + peers + `verify` + `UPGRADE_PROMPT.md` |
| تضخم الـ context | أداة واحدة + prefix + restrict + سقف 120 |
| تعديل موديل حقيقي بالغلط | deny افتراضي + ask + backup + audit |
| تسرب مفتاح API | credential seam + redaction + secret scanning (والحد المعروف لـ `credentials-local`) |
| تعارض بورتات داخلية | `doctor` + `probe` |
| processes يتيمة | disposers + اختبار cleanup |
| dependencies الـ servers تفشل على جهاز نضيف | `setup` + `servers.lock` + `doctor` يبلّغ بالناقص |
| servers.lock يعطي إنذارات كاذبة بسبب التحديث التلقائي لبعض servers | مسجّل + تحذير، مش إلزامي |
| الـ backup غير موحّد وممكن يعمل recursion في الـ policy | اختياري لكل pack + قائمة بيضاء ضيقة + confirm مع تحذير |
| تحميل مزدوج للحزمة | خدمة ترفض التحميل المزدوج برسالة واضحة |
| تلف discovered.json عند نسختين من التطبيق | atomic write + قفل |
| restrict بأسماء محددة والأدوات تظهر بعد الاتصال | تطبيقه عند tools/change مع معالجة الـ exception |

## 16. معايير القبول النهائية

- [ ] الحزمة تتثبت في profile تاني وعلى جهاز زميل بدون تعديل كود، وبدون Node أو pnpm أو build عند الزميل (tarball جاهز).
- [x] صف واحد في `cordis.patch.yml` يجيب host + UI + أوامر.
- [ ] `/aec` و`aec_control` يغطيان كل العمليات.
- [ ] الحالات الأربع صحيحة في الصفحة والأوامر.
- [x] discovery يعطي 5 من 6 على الأقل بدون إدخال يدوي.
- [x] write ممنوع في `deny`، والـ destructive بتأكيد، والـ audit كامل، والـ backup يسبق الكتابة حيث يدعمه الـ pack (وإلا confirm مع تحذير).
- [ ] `restrict` يعمل بالـ profiles تحت سقف الأدوات.
- [ ] المفاتيح خارج الـ config والـ logs والـ git.
- [ ] لا sign-in ولا CLI خارجي ولا تعديل upstream.
- [ ] `verify` بصفر أخطاء + loader smoke + تحديث upstream تجريبي ناجح.
- [x] `AGENTS.md` و`UPGRADE_PROMPT.md` و`INTEGRATION.md` موجودة ومحدّثة.
- [x] نقاط امتداد الـ agents موثقة بدون بناء أي agent.

## 17. بنود مفتوحة (محتاجة منك)

1. ✅ مسار `NavisHelper.McpServer.exe` بعد التثبيت.
2. ✅ Rhino يستخدم الكشف التلقائي للجسر مع fallback إلى standalone؛ تبقى أعلام AutoCAD (ezdxf/COM) مفتوحة.
3. ✅ طريقة تثبيت SketchUp من `.mcpb` حُسمت في ملحق القرارات.
4. ✅ معنى "نسخة احتياطية" لكل برنامج (Revit، Navis، Rhino...) موثق في §19.5.
5. ✅ مكان تخزين الـ tarball: المجلد المشترك موثق في §19.6.
6. ✅ profile نضيف للاختبار: `tbyaan-test` وprofile Phase 9 موثقان في §19.7.
7. ✅ الـ pack يضم ستة servers من برامج AEC المطلوبة.

## 18. الفرق عن الخطتين السابقتين

| البند | خطة المراحل | v2.2 | v3.0 |
| --- | --- | --- | --- |
| النطاق | أي MCP | AEC فقط | نواة عامة + pack-aec |
| التوزيع | installer للتطبيق | حزمة npm | حزمة منفصلة عبر git + `setup` |
| الأمان | غايب | قوي | قوي + backup قبل write |
| التحكم | UI كامل | أوامر + صفحة | أوامر أولًا ثم UI كامل |
| الاكتشاف | manifest | catalog + discovery | الاثنان معًا |
| التحديثات | غير مذكورة | `verify` | `verify` + `UPGRADE_PROMPT.md` + `patches/` |
| الـ agents | مقفولة | غير مذكورة | extension points فقط |

### ما تغيّر من 3.0 إلى 3.1

- ترتيب المراحل: الاكتشاف قبل الأوامر.
- التسليم: tarball جاهز بدل git + `link:`، ووعد الـ 15 دقيقة اتشال.
- `servers.lock`: مسجّل + تحذير بدل إلزامي.
- `setup`: handler لكل server.
- الـ backup: اختياري لكل pack بدل أساسي.
- `manifest` و`handle.ts`: وثيقة فقط في v1.
- الـ UI: شاشتان في v1.
- حماية من التحميل المزدوج، وكتابة atomic لـ `discovered.json`.
- المرحلة 0 اتقلصت لـ 5 بنود.

## 19. ملحق القرارات المؤكدة (2026-11-09)

قرارات اتأكدت من فحص الجهاز، وبتلغي البنود المقابلة في القسم 17.

### 19.1 البيئة الفعلية

| البرنامج | الحالة | ملاحظات |
| --- | --- | --- |
| Revit | ✅ 2020 / 2022 / 2023 / 2025 | `C:\Program Files\Autodesk\Revit <ver>\Revit.exe` |
| Navisworks | ✅ 2018/19/20/23/26 | MCP v2.30.0.0 متسطّب |
| AutoCAD | ✅ 2026 | نفس `acad.exe` بتاع Civil 3D |
| Civil 3D | ✅ 2026 | `D:\Civil 3D\AutoCAD 2026` |
| Rhino | ❌ مش متسطّب | البريدج `.rhp` مبني وجاهز + .NET 8 SDK موجود |
| SketchUp | ❌ (اتشال Viewer 2022) | خادم MCP v1.3.0 وملفات الجسر جاهزة؛ إعدادها لا يتطلب SketchUp Pro |

### 19.2 Navis (بند 17.1 مغلق)

- discovery: `McpServer\` أولًا، ثم glob على `AppData\Local\Navisworks MCP\versions\*\NavisHelper.McpServer.exe` واختيار أعلى إصدار، ثم override يدوي.
- `confidence`: `high` لو نسخة واحدة، `medium` لو أكتر من نسخة، `low` لو مفيش.
- `doctor` يبلّغ عن stale path بعد أي تحديث للـ installer.

### 19.3 Rhino (بند 17.2 مغلق)

- يكتشف الخادم جسر Rhino تلقائيًا، ويستخدم standalone (rhino3dm) عند غياب الجسر؛ لا نمرر علم `--mode` غير مدعوم.
- لا يتم تثبيت Rhino 8 في v1.

### 19.4 Civil3D / SketchUp (بند 17.3 مغلق)

- Civil3D: من السورس على `D:\Civil 3D\AutoCAD 2026`.
- SketchUp: تثبيت خادم MCP والجسر مستقل عن SketchUp Pro؛ ينسخ المعالج الجسر للتطبيق عند اكتشافه ويجهز ملف `.rbz` للتثبيت اليدوي.
- تفريق AutoCAD/Civil3D: markers (`C3D\` + `AecBase.dbx` + `AecCore.crx`) مش اسم الملف. ملفات `Aecc*` مش موجودة على هذا التثبيت (تأكد في Phase 0)، فتُستخدم كتلميح اختياري فقط.

### 19.5 Backup (بند 17.4 مغلق)

- الـ Hub لا ينسخ بنفسه؛ ينفّذ سياسة فقط، والنسخ حسب قدرة كل برنامج.
- Revit: لا يوجد save/backup في rvt-mcp → نسخة Hub فقط لو الملف مقفول (file-copy), وإلا `confirm` + تحذير. مسار المستند يُقرأ من `rvt-mcp` ويتم إضافته إلى `backup.files` في إعدادات الـ hub.
- Navis: read-only → لا backup.
- Rhino: `rhino_save` snapshot إلى `backups\<timestamp>.3dm`. لا يتم تثبيت Rhino 8؛ يعمل عبر rhino3dm المستقل (`mode: auto`). عند نقص نسخة Rhino 8، لا يتوفر `docPathTool` ما لم يُربط الجسر.
- AutoCAD/Civil3D: عندهم أدوات حفظ فعلًا (`drawing_save` / `drawing_save_as` / `civil3d_drawing{action:"save"}`)، لكن save-as بيعيد ربط المستند المفتوح، فمينفعش كنسخة احتياطية صامتة؛ الاعتماد على `.bak` الأصلي + confirm + audit، ونسخة Hub فقط لو الملف مقفول.
- SketchUp: `.skb` عند تثبيت Pro.
- `pack` يعلن `backup.supported` و`backup.tool` و`backup.pathArg` و`backup.docPathTool`؛ والافتراضي `false` مع تحذير.
- كل نسخة في `audit.jsonl` مع المسار والحجم والحجم/الـ hash.
- `failure: block` افتراضي: فشل النسخة يرفض الكتابة. `dedupeMs` الافتراضي 120,000 (إعادة استخدام النسخة الحديثة). `minFreeMb` الافتراضي 2048.

### 19.6 التوزيع (بند 17.5 مغلق)

- شبكة داخلية (مجلد مشترك) بدل GitHub Releases.
- مخرج البناء المحلي: `D:\OPENCODE\MCPs\TBYAAN-MCP-HUB\dist` (staging).
- النشر النهائي: `\\172.16.70.6\bim\PIN-SharedResources\06-EXE\TBYAAN-MCP-HUB\` (محتاج صلاحية من IT)، والبديل الفوري `\\172.16.70.14\data-transfer\TBYAAN-MCP-HUB\`.
- مسار النشر قابل للتهيئة في `setup` (مش hardcoded).
- البنية: `mcp-hub-<ver>.tgz` + `.sha256` + `latest.json` + `pack-aec-<ver>.tgz`.
- `latest.json`: `{ version, url, sha256, minDsh }`، والزميل يتحقق من الـ SHA256 قبل التثبيت.

### 19.7 Profile الاختبار (بند 17.6 مغلق)

- `~/.dsh/profiles/tbyaan-test` يُنشأ في المرحلة 1 (نسخة من `web`).
- كل مرحلة لا تُعد منتهية إلا بعد نجاحها في `tbyaan-test`.
- المرحلة 9 تستخدم profile ثالث نضيف لمحاكاة جهاز زميل.

### 19.8 عناصر أُغلقت

- ✅ نُشرت الحزم النهائية في `\\172.16.70.6\bim\PIN-SharedResources\06-EXE\TBYAAN-MCP-HUB\`؛ تم التحقق من SHA-256 للأرشيفين وملفي checksum مقابل `latest.json`.
- ✅ بنود المرحلة 0 التقنية الخمسة نُفِّذت بالكامل — التقرير: `TBYAAN-MCP-HUB\docs\PHASE0-AUDIT.md` (تصحيحات: markers الـ Civil3D، أدوات الحفظ، مسار Navis القديم، BOM في profile JSON).

### 19.9 خطة إكمال المرحلة 7

1. ✅ حصر حزمة AEC في ست وحدات وإزالة الوحدة المتقاعدة من الكتالوج ومعالج الإعداد وسجل الإصدارات ووثائق المشروع.
2. ✅ تجهيز خادم SketchUp والجسر وملف `.rbz` دون اشتراط وجود SketchUp Pro؛ تثبيت الجسر داخل مجلد Plugins فقط عند اكتشاف التطبيق.
3. ✅ إعادة بناء tarballs بعد آخر تعديلات setup والتوثيق؛ نجح typecheck والتحقق والتغليف، والحزم وSHA-256 و`latest.json` جاهزة في `dist`.
4. ✅ تحديث DSH profile المعزول بالحزم النهائية؛ صف Hub ووحدة AEC ظاهران، وفحص `discoverModules()` من الحزمة المثبتة وجد الخوادم الستة. تعذر `/aec discover` بسبب غياب adapter لمزوّد `local-models`.
5. ✅ مراجعة artifacts ونشر الحزم الخمس إلى المجلد الداخلي المشترك؛ بصمات الأرشيفين وملفات checksum تطابق `latest.json`.
