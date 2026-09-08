# FolderLens

Comparador privado de carpetas para el navegador. Compara la estructura, el tamaño y el contenido SHA-256 de los ficheros sin subirlos a Internet.

Los ficheros de texto marcados como **Distinto** se pueden abrir en un editor de dos paneles. El editor permite modificar cualquiera de los lados, copiar todo el contenido de izquierda a derecha o de derecha a izquierda y guardar el resultado.

## Privacidad

La comparación se ejecuta íntegramente en el navegador mediante las API `File` y `Web Crypto`. El servidor entrega solamente HTML, CSS y JavaScript: no recibe rutas, nombres ni contenido de los ficheros seleccionados.

Por seguridad, los navegadores no muestran la ruta completa del equipo. En su lugar, el usuario selecciona cada carpeta mediante el selector del sistema.

## Editor de diferencias

- Pulsa una fila marcada como **Distinto** para abrir sus dos versiones.
- La etiqueta superior detecta UTF-8, UTF-8 con BOM, UTF-16 LE/BE, ASCII o ANSI (Windows-1252).
- Usa **Copiar todo →** o **← Copiar todo** para sustituir un lado por el otro, o edita manualmente.
- En Chrome y Edge, el selector moderno permite solicitar permiso y guardar sobre el fichero original.
- En navegadores sin acceso de escritura, el botón de guardar descarga una copia editada.
- Los ficheros binarios y los textos mayores de 8 MB no se abren en el editor para evitar daños o un consumo excesivo de memoria.

## Desarrollo local

Requisitos: Node.js 20 o posterior.

```powershell
npm install
npm run build
npm start
```

La aplicación estará disponible en `http://127.0.0.1:4173`. También puedes ejecutar `iniciar.bat`, que usa el puerto `4317` para evitar conflictos con otros proyectos.

## Despliegue en Vercel

El repositorio incluye `vercel.json`; Vercel detectará automáticamente:

- Comando de instalación: `npm install`
- Comando de compilación: `npm run build`
- Directorio de salida: `dist/public`

### Desde Git

1. Sube esta carpeta a un repositorio de GitHub, GitLab o Bitbucket.
2. En Vercel, selecciona **Add New > Project** e importa el repositorio.
3. No es necesario añadir variables de entorno ni cambiar la configuración detectada.
4. Pulsa **Deploy**.

### Desde la CLI

```powershell
npm install -g vercel
vercel
vercel --prod
```

## Compatibilidad

Se recomienda una versión actual de Chrome, Edge, Firefox o Safari. La carpeta debe contener al menos un fichero para que el selector del navegador pueda incorporarla a la comparación.

El cálculo SHA-256 usa memoria proporcional al tamaño del fichero que se está procesando. Para ficheros extremadamente grandes, la versión local con servidor Node.js puede resultar más adecuada.
