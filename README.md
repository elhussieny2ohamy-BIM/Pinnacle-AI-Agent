# PINNACLE AI Agent — MCP Servers Bundle

مشروع واحد يحتوي على **مركز MCP (MCP Hub)** و**سكريبت تثبيت شامل** يزود جهازك بكل خوادم الـ MCP (Revit, Navisworks, AutoCAD, Civil 3D, Rhino, SketchUp) من غير ما تسطّب حاجة بره.

> يتم التطوير على فرع `my-custom-features`.

---

## ما يحتويه المشروع

| المجلد / الملف | الغرض |
|---|---|
| `TBYAAN-MCP-HUB/` | مركز MCP (واجهة Modules + Doctor، لوحة تحكم MCP) |
| `pack-aec/` | تعريفات وحدات AEC (Revit, Navisworks, AutoCAD, Civil 3D, Rhino, SketchUp) |
| `setup.ps1` | سكريبت التثبيت الرئيسي (يضغط زر واحد ويُثبت كل شيء) |
| `setup/runtime.ps1` | يتحقق وينصب التشغيلات: Node.js, .NET Runtime, uv/Python |
| `setup/servers.ps1` | ينزل ملفات خوادم MCP من GitHub Releases ويخوّنها في مكانها |
| `setup/plugins.ps1` | يحقن إضافات MCP داخل البرامج المضيفة (Revit, Rhino, SketchUp, Civil3D, Navis) |
| `setup/verify.ps1` | يختبر إن كل خادم MCP شغال قبل الانتهاء |
| `PROJECT.md` | دليل المشروع التقني الكامل |

---

## طريقة الاستخدام (لمستخدمي الفريق)

```powershell
# 1) نزّل المشروع (ZIP أو git clone)
git clone -b my-custom-features https://github.com/elhussieny2ohamy-BIM/Pinnacle-AI-Agent.git
cd Pinnacle-AI-Agent

# 2) شغل سكريبت التثبيت (يطلب Administrator عادة)
.\setup.ps1

# 3) بعد الانتهاء، شغل مركز MCP
cd TBYAAN-MCP-HUB
pnpm run build
pnpm run test
```

### خيارات السكربت

| الخيار | الغرض |
|---|---|
| `.\setup.ps1` | التثبيت الطبيعي (جميع المراحل) |
| `.\setup.ps1 -WhatIf` | ي.Show ما سيحدث من غير ما يثبت فعلياً |
| `.\setup.ps1 -SkipServers` | يتخطى تنزيل الخوادم (إذا كانت مثبتة بالفعل) |
| `.\setup.ps1 -SkipPlugins` | يتخطى حقن الإضافات في البرامج |
| `.\setup.ps1 -SkipVerify` | يتخطى الفحص النهائي |

---

## متطلبات النظام

يجب أن يكون على الجهاز (أو يُثبّت تلقائياً بواسطة السكربت):

- **Node.js** (لـ Civil 3D و SketchUp)
- **.NET Runtime 8+** (لـ Navisworks)
- **uv + Python** (لـ AutoCAD و Rhino)
- **برامج أوتوديسك/ماكوينل مثبتة** حسب الحاجة: Revit, AutoCAD, Civil 3D, Navisworks, Rhino, SketchUp

---

## ملاحظات للمطور

### كيفية إصدار نسخة جديدة مع الخوادم

الخوادم (~1 GB إجمالاً) تُرفع كـ **GitHub Release Assets** وليس داخل كود المستودع (لـ GitHub حد 100 للملف الفردي).

1. جهّز ملفات الخوادم مضغوطة (zip) لكل خادم:
   - `rvt-mcp-server.zip`
   - `NavisHelper.McpServer.zip`
   - `civil3d-mcp.zip`
   - `sketchup-mcp-server.zip`
   - (AutoCAD و Rhino يُثبتان عبر `uv` تلقائياً)

2. أنشئ Release جديد على GitHub برTAG مثل `v1.0.0` وارفع الملفات كـ Assets.

3. عدل مصفوفة `$script:ReleaseAssets` في `setup/servers.ps1` لتتوافق مع أسماء الملفات والتاج الجديد.

4. يُحدّث `pack-aec/index.js` إذا تغيرت مسارات التثبيت.

---

## الرخصة

UNLICENSED — للاستخدام الداخلي لفريق PINNACLE فقط.
