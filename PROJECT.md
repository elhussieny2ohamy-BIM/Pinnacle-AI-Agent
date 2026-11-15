# PINNACLE AI AGENT — دليل المشروع الشامل

> **المسار:** `D:\OPENCODE\MCPs`
> **آخر تحديث:** 2026-11-15
> **نظام التشغيل:** Windows 10 (x64) · **Shell:** PowerShell / Git Bash · **Node:** ‏≥ 24.9

هذا الملف نظرة عامة واحدة تجمع كل مكوّنات الـ workspace: المنصة، إضافة مركز MCP، حزمة AEC، خوادم CAD/BIM،
نظام البراند (PINNACLE)، وطريقة التشغيل والبناء والصيانة.

---

## 1) نظرة عامة

المشروع عبارة عن **Agent Harness** (منصة وكلاء برمجية) مبنية على معمارية **Cordis** قائمة على الإضافات،
وأُعيد تسميتها/توسيمها لتكون **PINNACLE AI AGENT**. تُقدَّم كتطبيق **Web** يعمل محليًا على المنفذ **3080**،
ومتصلة بخوادم **MCP** لبرامج الهندسة (Autodesk Revit / AutoCAD / Civil 3D / Navisworks، وRhino، وSketchUp)
عبر **مركز MCP** مخصّص يعرض حالة الوحدات وسياسات الكتابة والنسخ الاحتياطي والتشخيص.

```
[متصفح]  ──HTTP(token)──▶  dsh web (127.0.0.1:3080)
                              │  Cordis host + client (all-plugin)
                              ├─ @tbyaan/mcp-hub  (مركز PINNACLE MCP)
                              │     └─ @tbyaan/pack-aec (تعريفات وحدات AEC)
                              └─ خوادم MCP خارجية: Revit · AutoCAD · Civil 3D · Navisworks · Rhino · SketchUp
```

---

## 2) مكوّنات الـ Workspace

| المجلد | الوصف | التقنية / الإصدار |
|---|---|---|
| `deepseek-harness/` | المنصة الأساسية (الـ Harness) + الواجهة Web/Desktop | `@deepseek-ai/dsh-root@0.2.2-rc.3` · TypeScript ESM · Cordis |
| `TBYAAN-MCP-HUB/` | إضافة مركز MCP (عنصر السايدبار «PINNACLE MCP» + صفحة Modules/Doctor) | `@tbyaan/mcp-hub@0.1.3` · React 18 · tsdown |
| `pack-aec/` | حزمة تعريفات وحدات AEC (Revit, Navisworks, AutoCAD, Civil 3D, Rhino, SketchUp) | `@tbyaan/pack-aec@0.1.3` |
| `rvt-mcp-master/` | خادم MCP لـ Revit (RevitCortex) | MCP (rvt-mcp 1.2.x) |
| `Autocad-MCP-main/` | خادم MCP لـ AutoCAD | AutoCAD MCP Pro |
| `Civil3D-mcp-main/` | خادم MCP لـ Civil 3D | `civil3d-mcp@1.2.1` |
| `NavisWorksMaster-main/` | خادم MCP لـ Navisworks | MCP server |
| `rhino-mcp-main/` | خادم MCP لـ Rhino (standalone / bridge) | `rhino_mcp` (Python) |
| `Sketchup MCP/` | خادم MCP لـ SketchUp | Node + Ruby bridge |
| `Archive/` | ملفات مؤرشفة (غير مدمجة) | — |
| `Pinnacle-Logo.png` | الأصل الرئيسي لشعار الكلمة (Wordmark) | 1234×550 PNG |
| `Pinnacle sympol logo.png` | الأصل الرئيسي لرمز البراند (Symbol/Mark) | 431×590 PNG |

> ملاحظة: الجذر `D:\OPENCODE\MCPs` **ليس** مستودع git؛ المستودع الحقيقي هو `deepseek-harness/.git`.

---

## 3) المنصة: `deepseek-harness`

### المعمارية
- **all-plugin Cordis**: كل سلوك يُضاف عبر `ctx.effect()` / `ctx.on()` ونقاط امتداد موثّقة.
- **pnpm workspaces** بمعمارية `packages/<group>/<pkg>/` تحت بادئة `@deepseek-ai/dsh-*`.
- **ESM everywhere** (`"type": "module"`)، وNode `>=24.9`.
- واجهتان: **Web** (الافتراضية هنا) و**Desktop**.

### مجموعات الحزم المهمة
| المجموعة | الدور |
|---|---|
| `core/` | API الوكيل والجلسات |
| `api/` | BFF للاتصال عن بُعد |
| `mcp/` | الأدوات الخارجية (MCP) |
| `boot/` | إقلاع التطبيق وقراءة بيانات الإضافات (package meta) |
| `client/` | كل واجهة المستخدم (ui-sidebar, ui-conversation, ui-plugin-manager, ui-brand-official, ui-primitives …) |
| `bundle/` | حزم البروفايل (profiles) |
| `native/` | إضافة Node الأصلية (native addon) |
| `website/` | توثيق VitePress |
| `scripts/` | بوابات البناء والتوليد (gates) |

### الواجهة (Client)
- **Sidebar**: الهيدر يعرض البراند (رمز + كلمة Pinnacle)، وعناصر لوحة تشمل **PINNACLE MCP**.
- **البراند الرسمي**: `packages/client/ui-brand-official/src/client/Brand.tsx` يسجّل الخانات
  `sidebar.brand.mark` و`sidebar.brand.name`.
- **الرموز الأولية**: `packages/client/ui-primitives/src/FishLogo.tsx` (الرمز) و`BrandWordmark.tsx` (الكلمة).

---

## 4) البراند: PINNACLE

### الاسم المعروض
- الاسم الكامل: **PINNACLE AI AGENT**
- الاسم المختصر (PWA): **PINNACLE** / **TBH**
- عنوان التبويب: **PINNACLE AI AGENT**

### مصدر الحقيقة للأصول
| الأصل | الملف |
|---|---|
| الرمز (Symbol) | `deepseek-harness/packages/client/ui-primitives/src/tbyaan-assets.ts` → `TBYAAN_SYMBOL_DATA_URI` |
| الكلمة (Wordmark) | نفس الملف → `TBYAAN_WORDMARK_DATA_URI` |
| الأصول الرئيسية (خارج المستودع) | `D:\OPENCODE\MCPs\Pinnacle-Logo.png` + `D:\OPENCODE\MCPs\Pinnacle sympol logo.png` |

> الأصول تُضمَّن كـ **Base64 data URIs** داخل `tbyaan-assets.ts` مع أبعادها.
> أسماء المعرّفات الداخلية تبقى `TBYAAN_*` (توافق برمجي)، بينما **النص والصور المعروضة = Pinnacle**.

### أيقونات الويب والـ Desktop
| الموقع | الملفات |
|---|---|
| `apps/web/public/` | `favicon.svg`, `favicon-dark.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `manifest.webmanifest` |
| `apps/desktop/resources/` | `icon.png`, `icon-windows.png`, `icon-macos.png` + نسخ `.svg` |
| `apps/web/index.html` | روابط الأيقونات مع `?v=...` (cache-buster) |

### مركز MCP (البراند داخل الإضافة)
| الأصل | الملف |
|---|---|
| أيقونة الحزمة | `TBYAAN-MCP-HUB/icon.png` (رمز Pinnacle) |
| اسم العرض + الوصف | `TBYAAN-MCP-HUB/locale/{en,ar,zh}.json` → `meta.title = "PINNACLE MCP"` |
| مفتاح الاسم في الكود | `TBYAAN-MCP-HUB/src/client/locales.ts` → `panel: 'PINNACLE MCP'` |

### إجراء تحديث الشعار (Checklist)
1. استبدل أصل الـ PNG في `D:\OPENCODE\MCPs`.
2. أعد توليد `tbyaan-assets.ts` من الأصلين (Base64 + الأبعاد).
3. أعد توليد أيقونات `apps/web/public/` و`apps/desktop/resources/` من الرمز.
4. ارفع رقم الـ cache-buster في `apps/web/index.html` (مثال `?v=YYYYMMDD`).
5. `pnpm run build:artifacts` ثم أعد تشغيل السيرفر وتأكد بصريًا من التبويب والسايدبار.

---

## 5) التشغيل (PowerShell)

```powershell
# 1) تشغيل مباشر باستخدام البِلد الجاهز
cd D:\OPENCODE\MCPs\deepseek-harness
pnpm dsh web

# 2) تطوير: يبني الـ artifacts ثم يشغّل (ويُعيد بناء client عند التعديل)
pnpm run dev:web

# 3) تشغيل بدون بناء (الأسرع بعد build سابق)
pnpm run start:web

# 4) لا تفتح المتصفح تلقائيًا
pnpm dsh web --no-open
```

- **عنوان الدخول**: يظهر في سطر التشغيل بالشكل
  `dsh web: http://127.0.0.1:3080/?token=...` — فتحُه يحوّل (`303`) ويكتب الكوكي، وبعدها الجذر يرد `200`.
- **الجيل الأول قد يستغرق ~1 دقيقة** لأن خوادم MCP (Revit/Rhino/…) تهيّئ أدواتها قبل ربط المنفذ.

### تحرير المنفذ 3080 عند كونه مشغولًا
```powershell
Get-NetTCPConnection -LocalPort 3080 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

## 6) البناء والجودة (Building & Quality)

```powershell
cd D:\OPENCODE\MCPs\deepseek-harness
pnpm run build:artifacts   # 8 بوابات: native addon · Host Typert · host compiler · Host bundle
                           #          · Desktop bundle · client compiler · Client bundle · Web build
pnpm run build             # build:artifacts + build:check
pnpm run typecheck
pnpm run lint
pnpm run test              # اختبارات الوحدة
pnpm run doc-sync          # بوابات التوثيق
```

- حزم البروفايل المصدر: `~/.dsh/profiles/web` (انظر §8).

---

## 7) مركز MCP وحزمة AEC

### `@tbyaan/mcp-hub`
- **السايدبار**: يسجّل عنصرًا في `sidebar.panellist` بمعرّف `mcp-hub` والاسم **PINNACLE MCP** وترتيب `order: 100`.
  - الملف: `src/client/index.ts` → `label: () => t('panel')`.
  - الأيقونة: `src/client/HubPage.tsx` → `HubPageIcon` (رمز Pinnacle من `src/client/brand.ts`).
- **الصفحة الرئيسية**: `main` بالمفتاح `mcp-hub`، شاشتان: **Modules** و**Doctor**.
- **الاتصال بالـ Host**: عبر Typert remote namespace `tbyaanHub` (`src/remote.ts`).
- **التعريف/التكوين**: `cordis.patch.yml` يضيف الصف `id: tbyaan-mcp-hub`
  بإعدادات `packs: ['@tbyaan/pack-aec']`، `discovery.applyMode: confirm`،
  `defaults: { profile: coordination, writeMode: deny, maxVisibleTools: 120 }`.

### `@tbyaan/pack-aec`
- يعلن وحدات AEC: **Revit, Navisworks, AutoCAD, Civil 3D, Rhino, SketchUp**.
- يُثبَّت مع المركز في نفس البروفايل.

### بناء وتثبيت الإضافة
```powershell
cd D:\OPENCODE\MCPs\TBYAAN-MCP-HUB
pnpm run build        # tsdown → lib/index.js (host, ESM) + lib/client.js (client, CJS-factory)
pnpm run typecheck
```
- تثبيت الناتج في البروفايل (بديل سريع عن إعادة تثبيت الـ tarball):
```powershell
$H = "$HOME\.dsh\profiles\web\node_modules\@tbyaan\mcp-hub"
Copy-Item lib\* "$H\lib\" -Force
Copy-Item locale, icon.png, package.json "$H\" -Recurse -Force
```

---

## 8) الإعدادات والبروفايلات (`~/.dsh`)

| المسار | المحتوى |
|---|---|
| `~/.dsh/profiles/web/cordis.yml` | جذر البروفايل (قائمة فارغة، التركيب عبر patches) |
| `~/.dsh/profiles/web/cordis.patch.yml` | تعديلات البروفايل |
| `~/.dsh/profiles/web/package.json` | حزم البروفايل: `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@tbyaan/mcp-hub` |
| `~/.dsh/profiles/web/node_modules/` | الإضافات المثبّتة (منها مركز MCP) |
| `~/.dsh/installers/` | حزم tarball المثبّتة |
| `~/.dsh/sessions/` · `storages/` · `logs/` | الجلسات والتخزين والسجلات |
| `~/.dsh/tbyaan-hub/` | بيانات المركز (audit / backups) |

---

## 9) المسارات المرجعية السريعة

| ماذا تريد | المسار |
|---|---|
| تشغيل الويب | `deepseek-harness/` → `pnpm dsh web` |
| أصول البراند (Base64) | `deepseek-harness/packages/client/ui-primitives/src/tbyaan-assets.ts` |
| عنصر السايدبار/البراند | `.../ui-sidebar/src/client/SidebarRoot.tsx` |
| البراند الرسمي (slots) | `.../ui-brand-official/src/client/Brand.tsx` |
| أيقونات الويب | `deepseek-harness/apps/web/public/` |
| إعدادات HTML/العنوان | `deepseek-harness/apps/web/index.html` |
| مدير الإضافات (الواجهة) | `deepseek-harness/packages/client/ui-plugin-manager/` |
| مركز MCP (client) | `TBYAAN-MCP-HUB/src/client/index.ts` · `HubPage.tsx` · `locales.ts` |
| مركز MCP (brand) | `TBYAAN-MCP-HUB/src/client/brand.ts` · `icon.png` · `locale/*.json` |
| حزمة AEC | `pack-aec/` |
| بروفايل التشغيل | `~/.dsh/profiles/web` |

---

## 10) قواعد وملاحظات مهمة

- **لا ترفع بيانات اعتماد** (credentials/.env) إلى أي مستودع، ولا تنشر لأي مشاركة داخلية من جلسة الوكيل.
- **لا تنشئ commits** إلا عند الطلب الصريح.
- **ESM فقط**، واستخدم أسماء الحزم عبر الحزم و`.ts` في الاستيرادات المحلية النسبية.
- **نص الواجهة مملوك للـ locale** (عبر `t` وقواميس مكتوبة) ولا تُكتب نصوص المنتج مباشرة في المكوّنات.
- إعدادات `cordis.yml` تسمح بـ `!!js` (وليس `!js`) تحت `config` و`disabled`؛ بقية الحقول حرفية.
- عند تغيير أي سطح عام (CLI/بروفايل/إعدادات/API) سجّل التغيير في دليل الترقية.

---

## 11) استكشاف الأخطاء سريعًا

| العَرَض | السبب المحتمل | الحل |
|---|---|---|
| `EADDRINUSE 127.0.0.1:3080` | سيرفر سابق ما زال حيًّا (عملية node تابعة) | اقتل العملية على المنفذ (§5) |
| `401` على الجذر | فتح بدون توكن | استخدم رابط `?token=...` من سجل التشغيل |
| الإقلاع بطيء | تهيئة خوادم MCP | انتظر حتى يظهر سطر `dsh web: http://...` |
| تغييرات الإضافة لا تظهر | البِلد/النسخة في البروفايل قديمة | `pnpm run build` ثم انسخ `lib/` إلى البروفايل وأعد التشغيل |
| تغييرات الشعار لا تظهر في التبويب | كاش المتصفح | حدّث `?v=` في `index.html` وأعد البناء + Hard Reload |
| تحذير `disabling profile plugin undefined … startsWith` | صف/إضافة غير مكتملة التعريف في البروفايل | غير قاتل؛ راجع صفوف `cordis.patch.yml` إن أردت إزالته |

---

*هذا الملف مرجع حيّ؛ حدّثه عند تغيير المسارات أو الإصدارات أو إجراءات التشغيل.*
