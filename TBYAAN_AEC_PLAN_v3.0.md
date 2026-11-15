# TBYAAN MCP Hub: الخطة الموحدة (الإصدار 3.0)

دمج خطة المراحل (Stage 0–8) مع معمارية v2.2. القرارات الخمسة اتحسمت على الخيارات المرشّحة (أ في كل قرار).

> **تنبيه مهم:** تفاصيل DSH (`ctx.mcpManager`، `cordis.patch.yml`، `tools/pre-execute`، `ctx.configEditor`...) مأخوذة من وثيقة v2.2 ولم يتم التحقق منها على الكود الحقيقي. المرحلة 0 مهمتها تأكيد كل نقطة قبل كتابة أي كود. أي نسبة مئوية في الخطة تقدير مبني على خبرة مشاريع مشابهة وليست قياسًا.

## 1. الفكرة في سطرين

حزمة منفصلة تتركّب في أي مشروع DSH بسطر واحد، وبدونها المشروع يشتغل كما هو. النواة عامة (أي MCP server)، والـ AEC مجرد "pack" بيانات فوقها، والأمان مبني من أول يوم.

## 2. القرارات المعتمدة

| # | القرار | الاختيار | السبب |
| --- | --- | --- | --- |
| 1 | ترتيب الـ UI | أوامر الأول، UI في مرحلة متأخرة | الأدوات تشتغل من الشات حتى لو الـ UI اتأخر |
| 2 | الاكتشاف | تلقائي + تأكيد منك قبل التطبيق | مسار غلط لا يتشغّل أبدًا بدون موافقة |
| 3 | توزيع الحزمة | Git repo خاص + `link:` | تحديثات منظمة وتحكم في الإصدارات |
| 4 | تسطيب الـ servers | سكريبت `setup` + `doctor` يبلّغ بالناقص | أبسط من installer كامل |
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
@tbyaan/pack-aec        بيانات فقط: catalog لـ 7 MCPs (Revit, Navis, Rhino, AutoCAD, Civil3D, SketchUp, cortex)
@tbyaan/pack-<اسم>      مستقبلًا: packs جديدة بدون لمس النواة
```

- **النواة لا تعرف Revit.** كل معرفة بالبرامج موجودة في الـ pack.
- **إضافة MCP جديد = تعريف واحد في catalog**، بدون كود.
- **Revit:** `rvt-mcp` فقط، و`cortex` معطّل ومحجوز حتى يتم اختبار التعارض بينهم.

### هيكل الحزمة

```
@tbyaan/mcp-hub
├── package.json            (dsh.bundle.patch + dsh.client + engines.dsh + peers)
├── cordis.patch.yml        (صف واحد = host + UI + أوامر)
├── AGENTS.md               (خريطة الملفات وقواعد التعديل لأي AI agent)
├── UPGRADE_PROMPT.md       (prompt جاهز بعد أي تحديث upstream)
├── INTEGRATION.md          (كل نقطة اتصال بـ upstream)
├── servers.lock            (إصدارات الـ MCP servers المثبتة)
├── scripts/setup           (تسطيب الـ servers)
├── patches/                (لو في تعديل upstream لازم، منفصل وموثق)
├── src/
│   ├── index.ts            Config schema + wiring
│   ├── registry.ts         تحميل packs + manifests
│   ├── discovery.ts        اكتشاف مسارات + عمليات
│   ├── supervisor.ts       register/unregister/probe + app gate
│   ├── policy.ts           tools/pre-execute
│   ├── audit.ts            tools/result إلى JSONL
│   ├── backup.ts           نسخة احتياطية قبل أي write
│   ├── commands.ts         /aec و /mcp
│   ├── control-tool.ts     aec_control
│   ├── handle.ts           ServerHandle (نقطة امتداد للـ agents)
│   ├── remote.ts           خدمة للـ UI
│   ├── types.ts            types آمنة للـ client
│   └── client/             صفحة الـ UI
└── tests/
    ├── unit/
    └── composition/        loader smoke بـ cordis.yml حقيقي
```

### التركيب

من الواجهة: Plugins ثم Install ثم `link:<path>`. أو يدويًا بإضافة الصف في `cordis.patch.yml`:

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

## 6. الـ Catalog والـ Manifest

كل MCP يتعرّف بمدخل واحد: الاسم، الـ vendor، أسماء عمليات التطبيق، مسارات التثبيت المعروفة، أمر التشغيل (stdio)، الأوضاع (modes)، وهل يحتاج التطبيق مفتوحًا، وتلميحات تصنيف الأدوات (write / destructive).

- مصادر التعريف: الـ pack المدمج، أو `catalog.extra` في الـ config، أو ملف `mcp.manifest.json` داخل أي مشروع MCP (للمشاريع العامة خارج AEC).
- **صيغة الـ manifest الأدنى:** `name`, `icon`, `command`, `args`, `runtime`, `version`, `description`.

## 7. الاكتشاف (zero-config مع تأكيد)

`discover()` قراءة فقط ولا يسجّل أي server:

1. **التطبيقات:** العمليات الشغالة + مفاتيح Uninstall في الريجستري + مجلدات Autodesk/Trimble/McNeel المعروفة.
2. **الـ MCP نفسه:** مجلدات التثبيت المعروفة (أعلى نسخة)، ثم `npm ls -g` / `pip show` / `where`، ثم `roots` من الـ config.
3. **المخرجات:** `command` + `confidence` + `evidence` لكل module.
4. **التطبيق:** جدول تأكيد، ولا يُكتب شيء إلا بعد موافقتك.

**حدود صريحة:** Civil3D وSketchUp غالبًا مبنيين من السورس، فمسارهم من `roots` أو override يدوي. وAutoCAD وCivil3D يشتركان في `acad.exe` فنفرّق بينهم بـ `pathContains`.

**`doctor`** يفحص: الـ command محسوم؟ التطبيق موجود؟ البورتات الداخلية متعارضة (Civil3D :8080، SketchUp :9876)؟ خدمة الـ approval موجودة (لازمة لـ `ask`)؟ إصدار الـ pack؟ هل الـ servers مطابقة لـ `servers.lock`؟

## 8. الـ Supervisor

- `register(name, entry)` يرجع disposer، وكل شيء يتنظف عند الإيقاف (لا processes يتيمة).
- الحالات الأربع: `disabled` / `app_not_running` / `connected` / `error`.
- `app.gate` يبقى `off` حتى تملأ الـ discovery أسماء العمليات.
- `probe` = register مؤقت، ثم انتظار `connected` أو timeout، ثم dispose.
- Polling كل 20 ثانية بـ query واحد، ويتوقف لو مفيش module فيه gate مفعّل.
- multi-instance مؤجل صراحةً.

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

### نسخة احتياطية قبل أي write (جديد في 3.0)

قبل أول كتابة على موديل، يطلب الـ hub نسخة احتياطية أو يتأكد من وجود واحدة حديثة (حسب قدرات الـ MCP)، ويسجّل مسارها في الـ audit. لو الـ server لا يدعم ذلك، يظهر تحذير صريح ويتحول الوضع إلى `confirm`.

### Audit

ملفات JSONL في `~/.dsh/tbyaan-hub/audit/YYYY-MM.jsonl`: الوقت، session، agent، module، tool، قرار السياسة، النتيجة، المدة. مع redaction للأسرار.

### الأسرار

- `credentials-local` (ملف بصلاحيات owner-only) عبر `${credential:...}` فقط.
- **حد معروف:** هذا لا يعزل المفاتيح عن الـ agent لأنه نفس المستخدم. لا نعد بغير ذلك.
- المزودون (Anthropic / OpenAI / DeepSeek / Ollama / vLLM / LM Studio) عبر config على `llm-pi-ai` فقط، بدون provider package.
- ممنوع: Sign-In / cookies / session tokens.

## 11. الـ UI

- **أيقونة MCP دايمة** في الـ sidebar، تفتح الـ hub (صفحة في `main` slot).
- **الشاشات:** Modules (جدول + toggle + probe)، Catalog (الاكتشاف والثقة)، Profiles، Audit، Doctor.
- أي تغيير `writeMode` أو `enable` يحتاج تأكيدًا داخل الصفحة ويمر على نفس الـ policy.
- النصوص في locale dictionary (إنجليزي أساسي).
- **قاعدة:** كل شاشة لها أمر مقابل يُبنى قبلها، فالـ UI لا يكون نقطة فشل وحيدة.
- **تحذير:** هذه أغلى مرحلة (React + build خاص)، ومفيش client جاهز يرسم الـ settings.

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

1. `git clone` للـ repo الخاص.
2. `link:` من Plugins (أو إضافة الصف يدويًا).
3. `setup`: يركّب الـ MCP servers بإصدارات `servers.lock` ويبلّغ بالناقص.
4. `/aec doctor` للتشخيص.
5. `/aec discover` وتأكيد الجدول.

**الهدف:** زميل على جهاز نضيف ينجز الخطوات في أقل من 15 دقيقة. القياس يتم في مرحلة QA على جهاز حقيقي.

## 14. المراحل (مرحلة واحدة كل مرة، بموافقتك)

**قواعد كل مرحلة (تُلصق في أول كل prompt):**

1. استكشف أولًا، ثم اقترح خطة قصيرة، ثم انتظر موافقتي قبل تغيير أي كود.
2. اشتغل بخطوات صغيرة، وبعد كل خطوة قل ما تغيّر وكيف أختبره.
3. لا تكسر أي ميزة موجودة. تعديلات minimal ومنظمة.
4. طابق لغة وأسلوب الكود الموجود.
5. لو في شيء غير واضح، اسألني ولا تخمّن.

### المرحلة 0: Audit (بدون أي كود)

- تأكيد كل نقاط الاتصال في INTEGRATION على كودك الفعلي (`mcpManager`، `commands`، `configEditor`، `tools/pre-execute`، `dsh.bundle.patch`...).
- فحص لغة وإطار الـ UI وأين تعيش الأيقونة.
- تحديد مكان مشاريع الـ servers وكل runtime تحتاجه.
- **القبول:** تقرير قصير + أسئلتك اتجاوبت. أي بند اتضح إنه غلط في الوثيقة يتصحح قبل المتابعة.

### المرحلة 1: الهيكل والتحميل

- package + bundle patch + registry + manifest + أول صف يتحمّل.
- **القبول:** الحزمة تتثبت بـ `link:` في profile تاني نضيف وتظهر في Plugins، بدون كود في المشروع المضيف.

### المرحلة 2: Supervisor

- register/disposer، الحالات الأربع، app gate، polling، probe.
- **القبول:** `rvt` و`navis` يشتغلوا ويقفوا live بدون restart، والحالات صحيحة.

### المرحلة 3: الأوامر

- `/aec` كاملة، `/mcp` العام، `aec_control`، وremote API.
- **القبول:** كل عملية متاحة من الشات بدون تكرار في session log.

### المرحلة 4: الأمان

- policy (`deny`/`ask`)، audit JSONL، backup قبل write، `/aec audit`.
- **القبول:** write مرفوض في `deny`، و`confirm` يطلب موافقة، وكل write في الـ audit.

### المرحلة 5: Packs والاكتشاف

- `pack-aec` (7 modules)، `discovery.ts`، `doctor`، عرض الـ confidence.
- **القبول:** على جهازك، 5 من 7 على الأقل `high`، والباقي `medium/low` مع سبب واضح.

### المرحلة 6: الـ UI

- أيقونة MCP دايمة + الشاشات الخمس + i18n.
- **القبول:** توجل وحالة وprobe من الصفحة بدون terminal.

### المرحلة 7: التسليم

- `setup` + `servers.lock` + `INTEGRATION.md` + `AGENTS.md` + `UPGRADE_PROMPT.md` + `verify`.
- **القبول:** زميل ينصّب على جهاز نضيف في أقل من 15 دقيقة.

### المرحلة 8: نقاط امتداد الـ Agents (واجهات فقط)

- `ServerHandle` + Agent interface (role، system prompt، allowed tools، memory) + نفس الواجهة للأوامر والـ UI.
- **ممنوع بناء نظام الـ agents.** وثيقة قصيرة بأين ستتوصل.
- **المرحلة اللاحقة (agents + ملف guidance لكل server) مقفولة حتى تعطي إذنًا صريحًا.**

### المرحلة 9: QA

- تثبيت نضيف، إضافة server، حذف server، server بيقع، module معطّل، restart، وتحديث upstream تجريبي.
- **القبول:** `verify` بصفر أخطاء + loader smoke + نجاح الخطوات كلها على جهاز زميل.

## 15. المخاطر

| الخطر | الحل |
| --- | --- |
| وثيقة v2.2 فيها بنود غير متحقق منها | المرحلة 0 تؤكدها قبل أي كود |
| الـ client build صعب | يتأجل للمرحلة 6، وكل شاشة لها أمر بديل |
| discovery يغلط مسار | `confidence` + تأكيد + override يدوي |
| Civil3D/AutoCAD نفس `acad.exe` | `pathContains` ومسار التنفيذ |
| الحزمة تشتغل في profile واحد فقط | معيار قبول صريح: profile تاني + جهاز زميل |
| كسر توافق DSH بعد تحديث | `engines.dsh` + peers + `verify` + `UPGRADE_PROMPT.md` |
| تضخم الـ context | أداة واحدة + prefix + restrict + سقف 120 |
| تعديل موديل حقيقي بالغلط | deny افتراضي + ask + backup + audit |
| تسرب مفتاح API | credential seam + redaction + secret scanning (والحد المعروف لـ `credentials-local`) |
| تعارض بورتات داخلية | `doctor` + `probe` |
| processes يتيمة | disposers + اختبار cleanup |
| تعارض rvt/cortex | `cortex` معطّل حتى يُختبر |
| dependencies الـ servers تفشل على جهاز نضيف | `setup` + `servers.lock` + `doctor` يبلّغ بالناقص |

## 16. معايير القبول النهائية

- [ ] الحزمة تتثبت في profile تاني وعلى جهاز زميل بدون تعديل كود.
- [ ] صف واحد في `cordis.patch.yml` يجيب host + UI + أوامر.
- [ ] `/aec` و`aec_control` يغطيان كل العمليات.
- [ ] الحالات الأربع صحيحة في الصفحة والأوامر.
- [ ] discovery يعطي 5 من 7 على الأقل بدون إدخال يدوي.
- [ ] write ممنوع في `deny`، والـ destructive بتأكيد، والـ audit كامل، والـ backup يسبق الكتابة.
- [ ] `restrict` يعمل بالـ profiles تحت سقف الأدوات.
- [ ] المفاتيح خارج الـ config والـ logs والـ git.
- [ ] لا sign-in ولا CLI خارجي ولا تعديل upstream.
- [ ] `verify` بصفر أخطاء + loader smoke + تحديث upstream تجريبي ناجح.
- [ ] `AGENTS.md` و`UPGRADE_PROMPT.md` و`INTEGRATION.md` موجودة ومحدّثة.
- [ ] نقاط امتداد الـ agents موثقة بدون بناء أي agent.

## 17. بنود مفتوحة (محتاجة منك)

1. مسار `NavisHelper.McpServer.exe` بعد التثبيت.
2. أعلام `mode` لـ Rhino (standalone/bridge) وAutoCAD (ezdxf/COM).
3. Civil3D وSketchUp: مبنيين من السورس عندك أم منزّلين؟
4. profile تجريبي نضيف للاختبار: عندك واحد أم أعمله؟
5. هل الـ repo الخاص موجود على GitHub أم غيره؟ (يحدد طريقة توزيع الحزمة)
6. الـ MCP servers الخمسة الأصلية في خطة المراحل: هل هي نفس الـ 7 في الـ catalog أم مختلفة؟

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
