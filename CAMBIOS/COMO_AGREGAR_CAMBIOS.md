# 📝 Cómo Agregar Nuevos Cambios

Esta guía explica cómo registrar y documentar cada cambio que hagamos en el proyecto.

---

## 🔄 Proceso de Cambio (Paso a Paso)

### 1️⃣ **Editar el Código**
```bash
# Los cambios se hacen en C:\Users\hidro\Desktop\AlbertoCourierExpress\
# Archivos principales:
# - index.html (la web completa)
# - netlify.toml (configuración)
```

### 2️⃣ **Preparar Git**
```bash
cd "C:\Users\hidro\Desktop\AlbertoCourierExpress"

# Ver cambios
git status

# Agregar archivos (si hay varios)
git add .
# O específico:
git add index.html
```

### 3️⃣ **Hacer Commit**
```bash
# Formato recomendado:
git commit -m "🔧 Descripción breve del cambio (máx 50 caracteres)"

# Ejemplos:
git commit -m "🎨 Change colors to darker theme"
git commit -m "📱 Add mobile hamburger menu"
git commit -m "🔧 Fix form validation bug"
git commit -m "✨ Add WhatsApp button"
```

### 4️⃣ **Subir a GitHub**
```bash
git push origin main
```

### 5️⃣ **Netlify Despliega Automáticamente**
- Espera 30-60 segundos
- Verifica en: https://albertcourierexpress.com
- Dashboard: https://app.netlify.com/sites/albertcourierexpress

### 6️⃣ **Documentar el Cambio** (IMPORTANTE!)
Agregar una línea al archivo `CAMBIOS/CHANGELOG.md` con formato:

```markdown
#### 🔧 Commit N: Descripción
```
Commit: [hash corto]
Mensaje: "[Mensaje del commit]"

Cambios:
- Punto 1
- Punto 2
```
```

---

## 📝 Convención de Commit Messages

### Emojis Usados
```
🚀 Mejora importante/nueva feature
✨ Nueva funcionalidad
🔧 Bug fix o configuración
📱 Cambio responsive/móvil
🎨 Cambio de estilos/diseño
📊 Mejora de SEO
♿ Cambio de accesibilidad
💬 Cambio de contenido
📝 Documentación
⚡ Performance
🔐 Seguridad
```

### Ejemplos Reales
```
✨ Add dark mode toggle
🔧 Fix form validation issue
📱 Improve mobile navbar
🎨 Update color scheme to blue
📊 Add meta tags for SEO
♿ Add ARIA labels to forms
💬 Update contact number
```

---

## 📋 Plantilla para Documentar Cambios

Cuando hagas un cambio, **actualiza CAMBIOS/CHANGELOG.md** con esta estructura:

```markdown
#### [Emoji] Commit N: [Descripción del cambio]
```
Commit: [hash git corto]
Mensaje: "[Mensaje del commit]"

Cambios:
- ✅ [Feature 1]
- ✅ [Feature 2]
- 🔧 [Fix 1]

Líneas agregadas: X
Líneas eliminadas: Y
Archivos modificados: index.html
```
```

---

## 📊 Ejemplo Completo de Cambio

### Escenario: Cambiar color del botón

**Paso 1: Editar código**
```css
/* Antes */
.cta-btn {
    background-color: #ee6c4d; /* Naranja */
}

/* Después */
.cta-btn {
    background-color: #0066cc; /* Azul */
}
```

**Paso 2: Git**
```bash
git add index.html
git commit -m "🎨 Change CTA button color from orange to blue"
git push origin main
```

**Paso 3: Esperar deploy**
- 30-60 segundos...
- Verificar en: https://albertcourierexpress.com

**Paso 4: Documentar en CHANGELOG.md**
```markdown
#### 🎨 Commit N: Change CTA button color
```
Commit: [hash]
Mensaje: "🎨 Change CTA button color from orange to blue"

Cambios:
- 🎨 Updated .cta-btn background color
- 🎨 Updated .cta-btn:hover color
- 🔧 Maintained accessibility contrast ratio (AAA)

Archivos: index.html
```
```

---

## ✅ Checklist Antes de Hacer Commit

Antes de hacer `git push`, verifica:

- [ ] ¿El código está bien editado?
- [ ] ¿Probé los cambios en el navegador?
- [ ] ¿El formulario sigue funcionando?
- [ ] ¿El WhatsApp button está visible?
- [ ] ¿Mobile se ve bien?
- [ ] ¿Sin errores en consola?
- [ ] ¿Mensaje de commit es claro?

---

## 🔍 Verificar Cambios Después de Deploy

1. **Netlify Dashboard**
   - https://app.netlify.com
   - Verifica que el deploy pasó ✅

2. **Web en Vivo**
   - https://albertcourierexpress.com
   - Recarga (Ctrl+F5) y prueba
   - Verifica en móvil también

3. **GitHub**
   - https://github.com/hidrofilio/AlbertCourierexpress
   - Verifica que el commit está ahí

4. **Netlify Forms** (si es cambio de formulario)
   - https://app.netlify.com → Forms
   - Envía un test y verifica que llega el email

---

## 📚 Archivos de Documentación

Mantener actualizados estos 4 archivos:

1. **README.md** - Resumen general del proyecto
2. **CHANGELOG.md** - Historial de todos los commits
3. **FEATURES.md** - Detalles técnicos de cada feature
4. **COMO_AGREGAR_CAMBIOS.md** - Este archivo (guía de procesos)

---

## 💡 Tips & Tricks

### Comando rápido para todo junto:
```bash
cd "C:\Users\hidro\Desktop\AlbertoCourierExpress" && \
git add . && \
git commit -m "🔧 [Tu mensaje aquí]" && \
git push origin main
```

### Ver historial de cambios:
```bash
git log --oneline
```

### Ver cambios antes de commit:
```bash
git diff
git diff --staged
```

### Deshacer último commit (si algo salió mal):
```bash
git reset --soft HEAD~1  # Mantiene cambios
git reset --hard HEAD~1  # Descarta cambios
```

---

## 🚨 Importante

- ⚠️ **Siempre haz `git push`** después de commit
- ⚠️ **Documenta CADA cambio** en CHANGELOG.md
- ⚠️ **Verifica en la web** después de deploy
- ⚠️ **Prueba en móvil** también
- ⚠️ **No edites directamente en Netlify** - siempre usa GitHub

---

## 📞 Contacto

Si algo no funciona:
1. Verifica que el commit llegó a GitHub
2. Verifica que Netlify hizo el deploy
3. Recarga la web (Ctrl+Shift+R)
4. Verifica en otra pestaña anónima

**Email:** hidrofilio@gmail.com  
**WhatsApp:** +353 (87) 459 2308

---

**Última actualización:** 2026-09-09  
**Versión:** 1.0
