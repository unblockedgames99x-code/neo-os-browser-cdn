(function () {
  'use strict';
  const C = window.NEO_DESKTOP_CONFIG, B = window.NEO_SYSTEM_BRIDGE;
  if (!C || !B) return;
  const workspaceKey = 'neo_desktop_workspace_v1';
  let workspace;
  try { workspace = JSON.parse(localStorage.getItem(workspaceKey)); } catch (_) {}
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) workspace = Object.assign({}, C.workspace);
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function spriteIcon(id, cls) { const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');svg.classList.add('icon');if(cls)cls.split(' ').forEach(name=>name&&svg.classList.add(name));svg.setAttribute('aria-hidden','true');svg.setAttribute('viewBox','0 0 24 24');use.setAttribute('href','#'+id);svg.append(use);return svg; }
  function notify(message) { if (window.NEO_SHELL) window.NEO_SHELL.notify(message); }
  function saveFiles() { try { localStorage.setItem(workspaceKey, JSON.stringify(workspace)); window.dispatchEvent(new Event('neo-workspace-change')); return true; } catch (_) { notify('Device storage is full. Export your changes before closing.'); return false; } }
  function button(text, action, parent) { const b = el('button', '', text); b.type = 'button'; b.onclick = action; if (parent) parent.append(b); return b; }
  function row(parent) { const n = el('div', 'desktop-row'); parent.append(n); return n; }
  function section(parent, title) { const n = el('section', 'desktop-section'); n.append(el('h2', '', title)); parent.append(n); return n; }
  function select(parent, label, values, value, change) { const l = el('label', '', label), n = el('select'); values.forEach(v => { const o = el('option', '', v); o.value = v; n.append(o); }); n.value = value; n.onchange = () => change(n.value); l.append(n); parent.append(l); return n; }
  function updateSliderFill(input) { const min = Number(input.min) || 0, max = Number(input.max) || 100, value = Number(input.value); const progress = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0; input.style.setProperty('--neo-range-progress', progress + '%'); }
  function slider(parent, label, min, max, value, change) { const l = el('label', '', label + ' '), o = el('output', '', value), n = el('input'); n.type = 'range'; n.min = min; n.max = max; n.value = value; n.setAttribute('aria-label', label); n.oninput = () => { o.value = n.value; updateSliderFill(n); change(+n.value); }; updateSliderFill(n); l.append(o,n); parent.append(l); return n; }
  function check(parent, label, value, change) { const l = el('label'), n = el('input'); n.type = 'checkbox'; n.checked = value; n.onchange = () => change(n.checked); l.append(n, document.createTextNode(' ' + label)); parent.append(l); return n; }
  function download(name, text) { const a = el('a'); const url = URL.createObjectURL(new Blob([text], {type:'text/plain'})); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function cleanName(name) { return String(name || '').trim().replace(/\\/g,'/').replace(/^\/+/, '').replace(/[^a-zA-Z0-9_ .\-/]/g,'').split('/').filter(s => s && s !== '.' && s !== '..').join('/').slice(0,160); }
  function modal(title) { const d = el('dialog','desktop-palette desktop-app'); d.append(el('h2','',title)); document.body.append(d); d.addEventListener('close',()=>d.remove()); d.showModal(); return d; }
  function ask(title, label, value, accept) { const d = modal(title), form = el('form'), input = el('input'); input.value = value || ''; input.required = true; input.setAttribute('aria-label',label); form.append(el('label','',label),input); button('Cancel',()=>d.close(),form); const submit = button('Create',null,form); submit.type = 'submit'; form.onsubmit = e => { e.preventDefault(); if (accept(input.value) !== false) d.close(); }; d.append(form); input.focus(); }
  window.NEO_EXTRA_APPS = Object.assign(window.NEO_EXTRA_APPS || {}, {
    vscode: {id:'vscode',title:'Code workspace',name:'Code workspace',subtitle:'Local editor · VS Code-inspired',icon:'code',core:true,launcher:true,category:'Productivity',width:1040,height:650},
    personalize: {id:'personalize',title:'Personalization',name:'Personalization',subtitle:'Styles, themes, display, sound and wallpaper',icon:'settings',core:true,launcher:true,category:'System',width:820,height:640},
    skins: {id:'skins',title:'Widgets',name:'Widgets',subtitle:'Add and customize desktop widgets',icon:'widgets',core:true,launcher:true,category:'System',width:850,height:620}
  });

  function tabAppearanceEditor(parent) {
    const shell=window.NEO_SHELL, panel=section(parent,'Tab appearance');
    panel.classList.add('tab-appearance-section');
    const help=el('p','desktop-note','Change the name and icon shown in the Chromebook browser tab. Presets and custom icons stay on this device.');
    const grid=el('div','tab-appearance-grid');
    const status=el('p','tab-appearance-status');
    panel.append(help,grid,status);
    const presets=shell.getTabAppearancePresets();
    const buttons=new Map();

    function previewIcon(preset) {
      if(preset.id==='custom') return shell.getSetting('customTabIcon')||preset.icon;
      return preset.icon;
    }

    function sync() {
      if(!panel.isConnected){window.removeEventListener('neo-tab-appearance-change',sync);return;}
      const selected=shell.getSetting('tabAppearance')||'neo';
      presets.forEach(preset=>{
        const choice=buttons.get(preset.id);if(!choice)return;
        const active=selected===preset.id;
        choice.classList.toggle('is-selected',active);
        choice.setAttribute('aria-pressed',String(active));
        const image=choice.querySelector('img');if(image)image.src=previewIcon(preset);
      });
      const active=presets.find(preset=>preset.id===selected)||presets[0];
      status.textContent='Current tab: '+(active.id==='custom'?(shell.getSetting('customTabTitle')||'My tab'):active.title);
    }

    function openCustomEditor() {
      const d=modal('Custom Tab'), form=el('form','tab-appearance-form');d.classList.add('tab-appearance-dialog');
      const customFields=el('div','tab-appearance-custom-fields');
      const nameLabel=el('label','tab-appearance-field');nameLabel.append(el('span','','Tab name'));
      const name=el('input');name.type='text';name.maxLength=80;name.required=true;name.placeholder='Tab Name';name.value=shell.getSetting('customTabTitle')||'My tab';name.setAttribute('aria-label','Custom tab name');nameLabel.append(name);
      const storedIcon=shell.getSetting('customTabIcon')||'';
      let iconData=/^data:image\//i.test(storedIcon)?storedIcon:'';
      const urlLabel=el('label','tab-appearance-field');urlLabel.append(el('span','','Icon URL'));
      const iconUrl=el('input');iconUrl.type='url';iconUrl.maxLength=2048;iconUrl.placeholder='Icon URL';iconUrl.value=/^https?:\/\//i.test(storedIcon)?storedIcon:'';iconUrl.autocomplete='off';iconUrl.spellcheck=false;iconUrl.setAttribute('aria-label','Custom tab icon URL');urlLabel.append(iconUrl);
      customFields.append(nameLabel,urlLabel);form.append(customFields);
      const iconField=el('div','tab-appearance-field');iconField.append(el('span','','Tab icon'));
      const iconRow=el('div','tab-appearance-icon-row'), preview=el('img','tab-appearance-custom-preview');preview.alt='';
      const setPreview=source=>{preview.onerror=()=>{preview.onerror=null;preview.src='./assets/tab-appearance/custom.svg';};preview.src=source||'./assets/tab-appearance/custom.svg';};setPreview(storedIcon);
      iconUrl.onchange=()=>setPreview(iconUrl.value.trim());
      const picker=el('input');picker.type='file';picker.accept='.png,.jpg,.jpeg,.webp,.gif,.ico,image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon';picker.setAttribute('aria-label','Choose a custom tab icon');
      picker.onchange=()=>{const file=picker.files&&picker.files[0];if(!file)return;if(file.size>500*1024){notify('Choose an icon under 500 KB.');picker.value='';return;}const reader=new FileReader();reader.onload=()=>{iconData=String(reader.result||'');iconUrl.value='';setPreview(iconData);};reader.onerror=()=>notify('That icon could not be read.');reader.readAsDataURL(file);};
      const clear=button('Use default icon',()=>{iconData='';iconUrl.value='';picker.value='';setPreview('');});clear.classList.add('tab-appearance-clear');
      iconRow.append(preview,picker,clear);iconField.append(iconRow);
      form.append(iconField);
      const actions=el('div','tab-appearance-actions');button('Cancel',()=>d.close(),actions);const save=button('Save custom tab',null,actions);save.type='submit';actions.append(save);form.append(actions);
      form.onsubmit=event=>{event.preventDefault();if(shell.setCustomTabAppearance(name.value,iconUrl.value.trim()||iconData))d.close();};
      d.append(form);d.addEventListener('close',sync,{once:true});name.focus();
    }

    presets.forEach(preset=>{
      const choice=button('',preset.id==='custom'?openCustomEditor:()=>shell.setSetting('tabAppearance',preset.id),grid);
      choice.classList.add('tab-appearance-choice');choice.dataset.tabAppearanceChoice=preset.id;choice.setAttribute('aria-label','Use '+preset.label+' tab appearance');
      const visual=el('span','tab-appearance-icon');
      const image=el('img');image.alt='';image.setAttribute('aria-hidden','true');image.src=previewIcon(preset);visual.append(image);
      choice.append(visual,el('span','tab-appearance-label',preset.label));buttons.set(preset.id,choice);
    });
    window.addEventListener('neo-tab-appearance-change',sync);sync();
  }

  function interfaceStyleEditor(parent) {
    const shell=window.NEO_SHELL, panel=section(parent,'Styles');
    panel.classList.add('interface-style-section');
    panel.append(el('p','desktop-note','Styles change the complete NEO OS interface. Themes remain separate and continue to control the colors inside either style.'));
    const grid=el('div','interface-style-grid');panel.append(grid);
    const choices=new Map();
    const styles=[
      {id:'modern',label:'Modern',description:'The current NEO OS look'},
      {id:'retro',label:'Retro',description:'Compact classic desktop controls'}
    ];
    styles.forEach(style=>{
      const choice=button('',()=>shell.setSetting('interfaceStyle',style.id),grid);
      choice.classList.add('interface-style-choice');
      choice.dataset.interfaceStyleOption=style.id;
      choice.setAttribute('aria-label','Use '+style.label+' interface style');
      const preview=el('span','interface-style-preview is-'+style.id);
      preview.setAttribute('aria-hidden','true');
      preview.append(el('i','interface-preview-title'),el('i','interface-preview-pane'),el('i','interface-preview-sidebar'),el('i','interface-preview-taskbar'));
      const copy=el('span','interface-style-copy');
      copy.append(el('strong','',style.label),el('small','',style.description));
      choice.append(preview,copy);
      choices.set(style.id,choice);
    });
    function sync(){
      if(!panel.isConnected){window.removeEventListener('neo-interface-style-change',sync);return;}
      const selected=shell.getSetting('interfaceStyle')||'modern';
      choices.forEach((choice,id)=>{
        const active=id===selected;
        choice.classList.toggle('is-selected',active);
        choice.setAttribute('aria-pressed',String(active));
      });
    }
    window.addEventListener('neo-interface-style-change',sync);sync();
  }

  function rainmeterSettings(parent) {
    const panel=section(parent,'Rainmeter');
    panel.classList.add('rainmeter-settings-section');
    panel.append(el('p','desktop-note','Show or hide the desktop clock. Customize opens the skin, color, size, shadow and position controls.'));
    const controls=row(panel);controls.classList.add('rainmeter-settings-controls');
    const api=()=>window.NEO_RAINMETER;
    const getEnabled=()=>api()?.getState().enabled!==false;
    const enabled=check(controls,'Show desktop Rainmeter',getEnabled(),value=>api()?.setEnabled(value));
    enabled.setAttribute('aria-label','Show desktop Rainmeter');
    button('Customize Rainmeter',()=>api()?.open(),controls);
    function sync(event){
      if(!panel.isConnected){window.removeEventListener('neo-rainmeter-change',sync);return;}
      enabled.checked=event?.detail?.enabled!==undefined?event.detail.enabled:getEnabled();
    }
    window.addEventListener('neo-rainmeter-change',sync);sync();
  }

  function personalizationControls(app,options) {
    options=options||{};
    interfaceStyleEditor(app);
    rainmeterSettings(app);
    const p = B.get(), themes = section(app,'Theme'), grid = el('div','desktop-grid theme-grid'); themes.append(grid);
    Object.keys(C.themes).forEach(name => { const colors=C.themes[name],label=C.themeLabels?.[name]||name,b=button('',()=>B.set({theme:name}),grid),palette=el('span','theme-palette-preview'),accents=el('span','theme-accent-preview'); b.classList.add('theme-choice'); b.dataset.themeChoice=name; b.setAttribute('aria-label','Use '+label+' theme'); b.setAttribute('aria-pressed',String(name===p.theme)); b.style.setProperty('--theme-preview-bg',colors[0]); b.style.setProperty('--theme-preview-surface',colors[1]); b.style.setProperty('--theme-preview-text',colors[2]); b.style.setProperty('--theme-preview-line',colors[4]); b.style.setProperty('--theme-preview-accent',colors[5]); [colors[0],colors[1],colors[4]].forEach(color=>{const swatch=el('i');swatch.style.background=color;palette.append(swatch);}); [colors[5],colors[3],colors[2]].forEach(color=>{const swatch=el('i');swatch.style.background=color;accents.append(swatch);}); b.append(el('span','theme-choice-label',label),palette,accents); });
    tabAppearanceEditor(app);
    const sound = section(app,'Sound and display');
    const volume = slider(sound,'Master volume',0,100,p.volume,value=>B.set({volume:value}));
    const mute = check(sound,'Mute all local apps',p.muted,value=>B.set({muted:value}));
    const bright = slider(sound,'Interface brightness',45,100,p.brightness,value=>B.set({brightness:value}));
    sound.append(el('p','desktop-note','Brightness dims this interface, not the Chromebook display. Master sound applies to local HTML audio and cooperative Web Audio apps.'));
    const motion = check(sound,'Reduce motion',p.reducedMotion,value=>{ B.set({reducedMotion:value}); window.NEO_SHELL.setSetting('reducedMotion',value); });
    if(!options.integrated){
      const dock = section(app,'Taskbar and desktop');
      select(dock,'Taskbar placement', ['left','right','top','bottom'],window.NEO_SHELL.getSetting('taskbarPosition') || 'left',value=>window.NEO_SHELL.setSetting('taskbarPosition',value));
      button('Open all system settings',()=>window.NEO_SHELL.openApp('control'),dock);
    }
    function sync() { if (!app.isConnected) { window.removeEventListener('neo-system-state',sync); return; } const s=B.get(); volume.value=s.volume; volume.previousSibling.value=s.volume; bright.value=s.brightness; bright.previousSibling.value=s.brightness; updateSliderFill(volume); updateSliderFill(bright); mute.checked=s.muted; motion.checked=s.reducedMotion; app.querySelectorAll('[data-theme-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeChoice===s.theme))); }
    window.addEventListener('neo-system-state',sync);
  }

  function settings(body) {
    const app = el('div','desktop-app'); body.append(app); app.append(el('h1','','Personalization'));
    personalizationControls(app);
  }
  function skinGallery(body) {
    const widgetInfo={
      clock:{label:'Clock',description:'Time and date at a glance',category:'Essentials',icon:'i-monitor',accent:'#72d8ff'},
      calendar:{label:'Calendar',description:'Today and the current month',category:'Essentials',icon:'i-list',accent:'#fb923c'},
      notes:{label:'Notes',description:'A quick desktop notepad',category:'Essentials',icon:'i-file',accent:'#facc15'},
      weather:{label:'Weather',description:'Saved local conditions',category:'Essentials',icon:'i-sparkles',accent:'#60a5fa'},
      system:{label:'System',description:'NEO workspace status',category:'System',icon:'i-info',accent:'#a78bfa'},
      cpu:{label:'CPU',description:'Processor details',category:'System',icon:'i-monitor',accent:'#22d3ee'},
      ram:{label:'Memory',description:'Browser memory snapshot',category:'System',icon:'i-grid',accent:'#38bdf8'},
      storage:{label:'Storage',description:'Local storage usage',category:'System',icon:'i-folder',accent:'#fbbf24'},
      network:{label:'Network',description:'Connection status',category:'System',icon:'i-wifi',accent:'#34d399'},
      battery:{label:'Battery',description:'Charge and power state',category:'System',icon:'i-battery',accent:'#4ade80'},
      music:{label:'Now Playing',description:'Local music controls',category:'Media',icon:'i-music',accent:'#fb7185'},
      equalizer:{label:'Equalizer',description:'Animated playback visual',category:'Media',icon:'i-volume',accent:'#ec4899'},
      quote:{label:'Quote',description:'A small daily thought',category:'Tools',icon:'i-chat',accent:'#c084fc'},
      launcher:{label:'Launcher',description:'Shortcuts to favorite apps',category:'Tools',icon:'i-apps',accent:'#818cf8'}
    };
    const catalog=C.skinTypes.map(type=>Object.assign({type},widgetInfo[type]||{label:type,description:'Desktop widget',category:'Tools',icon:'i-apps',accent:'#72d8ff'}));
    const app=el('div','desktop-app widget-manager');body.append(app);
    const heading=el('header','widget-manager-heading'),headingCopy=el('div','widget-manager-heading-copy'),headingIcon=el('span','widget-manager-heading-icon');
    headingIcon.append(spriteIcon('i-grid'));
    headingCopy.append(el('h1','','Widgets'),el('p','','Add what you need, then drag widgets from any empty area and resize them from the edges.'));
    const total=el('span','widget-manager-total');heading.append(headingIcon,headingCopy,total);app.append(heading);

    const library=el('section','widget-library-section'),libraryHead=el('div','widget-section-heading'),libraryCopy=el('div');
    libraryCopy.append(el('h2','','Widget library'),el('p','','Choose a widget to add to your desktop.'));
    const styleField=el('label','widget-style-field'),styleLabel=el('span','','New widget style'),styleSelect=el('select');
    C.skinStyles.forEach(value=>{const option=el('option','',value.replace(/(^|-)([a-z])/g,(_,dash,letter)=>(dash?' ':'')+letter.toUpperCase()));option.value=value;styleSelect.append(option);});
    let style='minimalist',category='All';styleSelect.value=style;styleSelect.onchange=()=>style=styleSelect.value;styleField.append(styleLabel,styleSelect);libraryHead.append(libraryCopy,styleField);library.append(libraryHead);
    const filters=el('div','widget-category-filter');filters.setAttribute('role','group');filters.setAttribute('aria-label','Filter widget library');library.append(filters);
    const grid=el('div','widget-library-grid');library.append(grid);app.append(library);

    const installed=el('section','widget-installed-section'),installedHead=el('div','widget-section-heading'),installedCopy=el('div'),installedCount=el('span','widget-installed-count');
    installedCopy.append(el('h2','','On your desktop'),el('p','','Show, hide, or customize the widgets you have added.'));
    installedHead.append(installedCopy,installedCount);installed.append(installedHead);
    const list=el('div','widget-installed-list');installed.append(list);app.append(installed);

    function addWidget(item){window.NEO_SKINS.add(item.type,style);refresh();notify(item.label+' widget added');}
    function renderFilters(){filters.replaceChildren();['All','Essentials','System','Media','Tools'].forEach(name=>{const choice=button(name,()=>{category=name;renderFilters();renderLibrary();},filters);choice.classList.add('widget-category-button');choice.setAttribute('aria-pressed',String(category===name));});}
    function renderLibrary(){grid.replaceChildren();catalog.filter(item=>category==='All'||item.category===category).forEach(item=>{const card=button('',()=>addWidget(item),grid);card.classList.add('widget-library-card');card.dataset.widgetType=item.type;card.style.setProperty('--widget-accent',item.accent);const visual=el('span','widget-library-icon');visual.append(spriteIcon(item.icon));const copy=el('span','widget-library-copy');copy.append(el('strong','',item.label),el('small','',item.description));const add=el('span','widget-library-add');add.append(spriteIcon('i-plus'));card.append(visual,copy,add);card.setAttribute('aria-label','Add '+item.label+' widget');});}
    function refresh(){
      const widgets=window.NEO_SKINS.list();total.textContent=widgets.length+' added';installedCount.textContent=widgets.length+' widget'+(widgets.length===1?'':'s');list.replaceChildren();
      if(!widgets.length){const empty=el('div','widget-empty-state'),visual=el('span','widget-empty-icon');visual.append(spriteIcon('i-grid'));empty.append(visual,el('h3','','Your desktop is ready'),el('p','','Add a widget from the library above. The built-in desktop clock stays available.'));const first=button('Add a clock',()=>addWidget(catalog.find(item=>item.type==='clock')),empty);first.classList.add('widget-empty-action');list.append(empty);return;}
      widgets.forEach(widget=>{const item=widgetInfo[widget.type]||{label:widget.type,icon:'i-apps',accent:'#72d8ff'},card=el('article','widget-installed-card');card.style.setProperty('--widget-accent',item.accent);const visual=el('span','widget-installed-icon');visual.append(spriteIcon(item.icon));const copy=el('div','widget-installed-copy');copy.append(el('strong','',item.label),el('small','',(widget.hidden?'Hidden':'On desktop')+' · '+widget.style.replace(/-/g,' ')));const actions=el('div','widget-installed-actions');const visibility=button('',()=>{window.NEO_SKINS.show(widget.id,widget.hidden);refresh();},actions);visibility.classList.add('widget-action-button');visibility.append(spriteIcon('i-eye'),el('span','',widget.hidden?'Show':'Hide'));visibility.setAttribute('aria-label',(widget.hidden?'Show ':'Hide ')+item.label+' widget');const customize=button('',()=>window.NEO_SKINS.edit(widget.id),actions);customize.classList.add('widget-action-button','is-primary');customize.append(spriteIcon('i-settings'),el('span','','Customize'));customize.setAttribute('aria-label','Customize '+item.label+' widget');card.append(visual,copy,actions);list.append(card);});
    }
    renderFilters();renderLibrary();
    refresh();window.addEventListener('neo-skins-changed',refresh);body._neoDesktopCleanup=()=>window.removeEventListener('neo-skins-changed',refresh);
  }

  function editor(body) {
    const app=el('div','desktop-app desktop-editor'), toolbar=el('div','editor-toolbar desktop-row'), main=el('div','editor-main'), explorer=el('nav','editor-explorer'), divider=el('div','editor-divider'), right=el('div','editor-right'), tabs=el('div','editor-tabs'), pane=el('div','editor-code'), numbers=el('pre','editor-lines'), input=el('textarea'), status=el('div','editor-status');
    explorer.setAttribute('aria-label','Workspace files'); divider.setAttribute('role','separator'); divider.setAttribute('aria-label','Workspace and editor divider'); divider.setAttribute('aria-orientation','vertical'); input.setAttribute('aria-label','Code editor'); input.spellcheck=false; input.wrap='off';
    pane.append(numbers,input);right.append(tabs,pane);main.append(explorer,divider,right);app.append(toolbar,main,status);body.append(app);
    let active=Object.keys(workspace)[0] || '', opened=active?[active]:[], drafts=Object.assign({},workspace);const dirty=new Set();
    button('New file',()=>ask('New file','File name','untitled.txt',name=>{name=cleanName(name);if(!name||Object.hasOwn(workspace,name)){notify('Choose a new valid file name.');return false;}workspace[name]='';if(!saveFiles())return false;drafts[name]='';open(name);}),toolbar);
    const picker=el('input');picker.type='file';picker.multiple=true;picker.hidden=true;app.append(picker);
    button('Import',()=>picker.click(),toolbar);picker.onchange=async()=>{for(const file of picker.files){const name=cleanName(file.name);if(!name||file.size>2*1024*1024){notify('Use text files smaller than 2 MB.');continue;}if(Object.hasOwn(workspace,name)){notify(name+' already exists; rename it before importing.');continue;}workspace[name]=await file.text();drafts[name]=workspace[name];if(saveFiles())open(name);}picker.value='';};
    function save(){if(!active)return;workspace[active]=input.value;drafts[active]=input.value;if(saveFiles()){dirty.delete(active);renderTabs();updateStatus('Saved on this device');}}
    button('Save',save,toolbar);button('Export',()=>active&&download(active,input.value),toolbar);
    button('Preview HTML',()=>{ if(!active)return; const d=modal('Sandbox preview · no network or system access'), f=el('iframe','editor-preview');f.title='HTML preview';f.sandbox='allow-scripts';const policy='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; media-src data: blob:; connect-src \'none\'; form-action \'none\'">';f.srcdoc=policy+input.value;d.append(f);button('Close',()=>d.close(),d); },toolbar);
    function palette(){ const d=modal('Command palette'), q=el('input');q.placeholder='Search commands';q.setAttribute('aria-label','Search commands');d.append(q);const list=el('div','desktop-grid');d.append(list);const commands=[['Save file',save],['Export file',()=>download(active,input.value)],['Open terminal',()=>window.NEO_SHELL.openApp('terminal')],['Open settings',()=>window.NEO_SHELL.openApp('control')],['About this editor',()=>{notify('Local editor simulation inspired by VS Code. No Microsoft extensions, services or system shell.');}]];function draw(){list.replaceChildren();commands.filter(c=>c[0].toLowerCase().includes(q.value.toLowerCase())).forEach(c=>button(c[0],()=>{d.close();c[1]();},list));}q.oninput=draw;draw();q.focus(); }
    button('Commands',palette,toolbar);
    button('Delete file',()=>{if(!active)return;const d=modal('Delete '+active+'?');d.append(el('p','','This removes the file from this device workspace. Export it first if you need a copy.'));button('Cancel',()=>d.close(),d);button('Delete',()=>{delete workspace[active];delete drafts[active];opened=opened.filter(x=>x!==active);saveFiles();d.close();open(opened[0]||Object.keys(workspace)[0]||'');},d);},toolbar);
    function updateStatus(message){ const before=input.value.slice(0,input.selectionStart);status.textContent=(message||('Ln '+before.split('\n').length+', Col '+(before.length-before.lastIndexOf('\n'))))+' · '+(active||'No file')+' · Local simulation · not VS Code';numbers.textContent=Array.from({length:Math.max(1,input.value.split('\n').length)},(_,i)=>i+1).join('\n'); }
    function renderTabs(){tabs.replaceChildren();opened.forEach(name=>{const group=el('span','desktop-row');const b=button(name+(drafts[name]!==workspace[name]?' •':''),()=>open(name),group);b.setAttribute('aria-pressed',String(name===active));const close=button('×',()=>{if(active)drafts[active]=input.value;opened=opened.filter(n=>n!==name);if(active===name)open(opened[0]||'');else renderTabs();},group);close.setAttribute('aria-label','Close '+name);tabs.append(group);});}
    function open(name){if(active)drafts[active]=input.value;active=name;if(active&&!opened.includes(active))opened.push(active);input.value=active?(drafts[active]??workspace[active]??''):'';input.disabled=!active;explorer.replaceChildren(el('strong','','WORKSPACE'));Object.keys(workspace).sort().forEach(n=>button(n,()=>open(n),explorer));renderTabs();updateStatus();}
    input.oninput=()=>{drafts[active]=input.value;dirty.add(active);renderTabs();updateStatus();};input.onclick=()=>updateStatus();input.onkeyup=()=>updateStatus();input.onscroll=()=>numbers.scrollTop=input.scrollTop;
    input.onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();input.setRangeText('  ',input.selectionStart,input.selectionEnd,'end');input.oninput();}};
    app.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save();}if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='p'){e.preventDefault();palette();}});
    // Persist drafts before the containing app closes, not only on browser unload.
    body._neoDesktopCleanup=()=>{if(active)drafts[active]=input.value;dirty.forEach(n=>{if(Object.hasOwn(workspace,n))workspace[n]=drafts[n];});if(dirty.size)saveFiles();};
    // Avoid copying an empty textarea over the first existing file on initial mount.
    active='';open(opened[0]||'');
  }

  function terminal(body) {
    const key='neo_terminal_sessions_v1';let sessions;try{sessions=JSON.parse(localStorage.getItem(key));}catch(_){}if(!Array.isArray(sessions)||!sessions.length)sessions=[{id:Date.now(),lines:['NEO local terminal — simulated commands; no system shell.','Type help to see available commands.'],history:[]}];sessions=sessions.slice(0,8).map(s=>({id:s.id||Date.now(),lines:Array.isArray(s.lines)?s.lines.slice(-300).map(String):[],history:Array.isArray(s.history)?s.history.slice(-100).map(String):[]}));
    const app=el('div','desktop-app desktop-terminal'),tabs=el('div','terminal-tabs'),log=el('pre','terminal-log'),form=el('form','terminal-composer'),input=el('input');input.setAttribute('aria-label','Terminal command');input.autocomplete='off';form.append(el('span','', 'neo:~/workspace $'),input);button('Run',null,form).type='submit';app.append(tabs,log,form);body.append(app);log.setAttribute('role','log');log.setAttribute('aria-live','polite');let active=sessions[0],cursor=active.history.length;
    function persist(){try{localStorage.setItem(key,JSON.stringify(sessions));}catch(_){notify('Terminal history could not be saved.');}}
    function draw(){tabs.replaceChildren();sessions.forEach((s,i)=>{const r=row(tabs);const b=button('Session '+(i+1),()=>{active=s;cursor=s.history.length;draw();},r);b.setAttribute('aria-pressed',String(s===active));if(sessions.length>1)button('×',()=>{sessions=sessions.filter(x=>x!==s);if(active===s)active=sessions[0];persist();draw();},r);});button('+',()=>{if(sessions.length>=8)return notify('Up to 8 terminal sessions.');active={id:Date.now(),lines:['New local session.'],history:[]};sessions.push(active);cursor=0;persist();draw();},tabs);log.textContent=active.lines.join('\n');log.scrollTop=log.scrollHeight;}
    function run(command){const [name,...args]=command.trim().split(/\s+/),arg=args.join(' ');let result='';switch(name.toLowerCase()){
      case 'help':result='help, clear, echo TEXT, date, pwd, ls, cat FILE, open APP, apps, whoami, version, settings, theme NAME, volume 0–100, fullscreen\nFiles are the local Code workspace. Commands never execute programs or network requests.';break;
      case 'clear':active.lines=[];break;case 'echo':result=arg;break;case 'date':result=new Date().toString();break;case 'pwd':result='/neo/workspace (local simulation)';break;case 'ls':result=Object.keys(workspace).join('\n');break;case 'cat':result=Object.hasOwn(workspace,arg)?workspace[arg]:'File not found. Use ls.';break;
      case 'apps':result=window.NEO_SHELL.getApps().map(a=>a.id+' — '+(a.title||a.name||a.id)).join('\n');break;
      case 'open':if(window.NEO_SHELL.getApps().some(a=>a.id===arg)){window.NEO_SHELL.openApp(arg);result='Opened '+arg;}else result='Unknown app. Use apps.';break;
      case 'whoami':result='Local device user';break;case 'version':result='NEO OS · local desktop';break;case 'settings':window.NEO_SHELL.openApp('control');break;
      case 'theme':if(Object.hasOwn(C.themes,arg)){B.set({theme:arg});result='Theme: '+arg;}else result='Themes: '+Object.keys(C.themes).join(', ');break;
      case 'volume':if(arg!==''&&Number.isFinite(+arg)&&+arg>=0&&+arg<=100){B.set({volume:+arg});result='Master volume: '+arg;}else result='Usage: volume 0–100';break;
      case 'fullscreen':document.documentElement.requestFullscreen?.().catch(()=>notify('Fullscreen was declined by this browser.'));break;
      case '':break;default:result='Unsupported local command: '+name+'. Type help. No system command was executed.';
    }if(result)active.lines.push(result);active.lines=active.lines.slice(-300);}
    form.onsubmit=e=>{e.preventDefault();const command=input.value.trim();if(!command)return;active.lines.push('$ '+command);active.history.push(command);active.history=active.history.slice(-100);input.value='';run(command);cursor=active.history.length;persist();draw();};input.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();cursor=Math.max(0,Math.min(active.history.length,cursor+(e.key==='ArrowUp'?-1:1)));input.value=active.history[cursor]||'';}};draw();
  }
  function init(){
    window.NEO_SKINS.init();
    const shade=el('div');shade.id='neo-brightness-shade';shade.setAttribute('aria-hidden','true');document.body.append(shade);
    function sync(){const p=B.get();shade.style.opacity=String(1-p.brightness/100);document.querySelectorAll('iframe').forEach(f=>{try{f.contentWindow.postMessage({type:'neo-system-preferences',state:p},location.origin);}catch(_){}});}
    window.addEventListener('neo-system-state',sync);document.addEventListener('visibilitychange',sync);window.addEventListener('neo-performance-mode-change',sync);sync();
    window.addEventListener('storage',e=>{if(e.key===workspaceKey){try{const next=JSON.parse(e.newValue);if(next&&typeof next==='object')workspace=next;}catch(_){}}});
    window.addEventListener('neo-storage-warning',()=>notify('Storage is full or unavailable. Export important files before closing.'));
    // Existing closeWindow removes the app node. Flush editor drafts before removal.
    const layer=document.querySelector('#window-layer, .window-layer');if(layer)new MutationObserver(records=>records.forEach(r=>r.removedNodes.forEach(n=>{n.querySelectorAll?.('.window-body').forEach(b=>b._neoDesktopCleanup?.());}))).observe(layer,{childList:true});
  }
  window.NEO_DESKTOP={mount(id,body){const handlers={personalize:settings,skins:skinGallery,vscode:editor,terminal};if(!handlers[id])return false;handlers[id](body);return true;},enhance(id,body){if(id==='control'){body.querySelectorAll('.desktop-settings-shortcuts').forEach(shortcut=>shortcut.remove());const control=body.querySelector('.control-center'),taskbar=control&&control.querySelector('.taskbar-settings');if(control&&taskbar&&!control.querySelector('.integrated-personalization-settings')){const integrated=el('section','settings-section integrated-personalization-settings desktop-app');control.insertBefore(integrated,taskbar);personalizationControls(integrated,{integrated:true});}}},init};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else queueMicrotask(init);
})();
