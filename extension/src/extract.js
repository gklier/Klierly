// Functions injected into the active tab with chrome.scripting.executeScript
// after the user clicks the toolbar icon. Each one is serialised on its own,
// so it must be fully self-contained: no imports, no references to anything
// outside its own body.
//
// Neither function sends anything anywhere, changes the page, or reads
// cookies, storage, form values or frames.

/**
 * Step 1: gather assessment signals. Returns counts, booleans and matched
 * button / vendor labels only — no page content — so that a blocked page is
 * never read into the popup.
 */
export function collectSignals() {
  const isVisible = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0);
  const all = (selector, root = document) => {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return [];
    }
  };

  const ANSWER = 'input[type="radio"], input[type="checkbox"], textarea, input[type="text"][name*="question" i], select[name*="question" i]';
  const QUESTION = '.question, .display_question, .que, [class*="question" i], [id^="question_" i]';
  const QUIZ_FORM = '#submit_quiz_form, form[id*="quiz" i], form[class*="quiz" i], [class*="quiz" i] form, form[action*="/quizzes/" i], form[action*="attempt" i]';

  const answerSet = new Set();
  let questionGroups = 0;
  for (const group of all(QUESTION)) {
    if (group.parentElement && group.parentElement.closest(QUESTION)) continue; // count outermost only
    if (group.matches('form, body, html')) continue;
    const inputs = all(ANSWER, group).filter(isVisible);
    if (inputs.length) {
      questionGroups += 1;
      inputs.forEach((input) => answerSet.add(input));
    }
  }
  let quizForm = false;
  for (const form of all(QUIZ_FORM)) {
    const inputs = all(ANSWER, form).filter(isVisible);
    if (inputs.length) {
      quizForm = true;
      inputs.forEach((input) => answerSet.add(input));
    }
  }

  const SUBMIT = /^(submit|finish|end|hand in)\s+(the\s+)?(quiz|exam|test|attempt|assessment|all and finish)\b/i;
  const START = /^(take|start|begin|resume|re-?take|attempt)\s+(the\s+)?(quiz|exam|test|attempt|assessment)\b/i;
  const submitButtons = [];
  let startButton = false;
  for (const el of all('button, input[type="submit"], input[type="button"], [role="button"], a.btn, a.button')) {
    if (!isVisible(el)) continue;
    const label = String(el.tagName === 'INPUT' ? el.value : el.innerText || el.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    if (SUBMIT.test(label)) submitButtons.push(label);
    else if (START.test(label)) startButton = true;
  }

  const bodyText = document.body ? document.body.innerText || '' : '';
  const timerText = /\btime\s+(remaining|elapsed|left)\b/i.test(bodyText);
  const runningTimer = /\btime\s+(remaining|elapsed|left)\b[\s:\-–]{0,12}(\d{1,3}:\d{2}(:\d{2})?|\d+\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b)/i.test(bodyText);
  const vendors = [
    ['Respondus', /respondus/i],
    ['LockDown Browser', /lock\s?down\s?browser/i],
    ['Honorlock', /honorlock/i],
    ['ProctorU', /proctoru\b/i],
    ['Proctorio', /proctorio/i],
    ['Examity', /examity/i],
  ];
  const proctoring = vendors.filter(([, re]) => re.test(bodyText)).map(([name]) => name);

  const selection = window.getSelection();
  const hasSelection = Boolean(selection && !selection.isCollapsed && selection.toString().trim());

  return {
    url: location.href,
    title: document.title,
    hasSelection,
    domSignals: { questionGroups, answerInputs: answerSet.size, quizForm, submitButtons, startButton, timerText, runningTimer, proctoring },
  };
}

/**
 * Step 2 (only if the guard allowed it): return the currently rendered,
 * visible text of the page, or of the user's selection.
 *
 * Left out: scripts/styles, every form control and its value, embedded
 * frames and media, site chrome (nav, header, footer, sidebars), anything
 * hidden with CSS / `hidden` / aria-hidden, and grade or roster blocks.
 */
export function extractVisibleText(options) {
  const selectionOnly = Boolean(options && options.selectionOnly);

  const SKIP_CODE = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE']);
  const SKIP_FORM = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'OPTGROUP', 'DATALIST', 'BUTTON', 'OUTPUT', 'METER', 'PROGRESS']);
  const SKIP_EMBED = new Set(['IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'MAP', 'DIALOG']);
  const PARAGRAPH = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'TABLE', 'UL', 'OL', 'DL', 'FIGURE', 'SECTION', 'ARTICLE']);
  const CHROME =
    'nav, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"], [role="menu"], [role="menubar"], [role="toolbar"], ' +
    '#header, #footer, #left-side, #right-side, #breadcrumbs, #section-tabs, #sidebar, .sidebar, .breadcrumbs, .breadcrumb, .ic-app-header, .ic-app-nav-toggle-and-crumbs';
  const PRIVATE_WORDS = new Set(['grade', 'grades', 'gradebook', 'roster', 'rosters', 'classlist']);
  const GRADE_HEADER = /^(your |final |letter |current |total )?grades?$/i;

  const excluded = { navigation: 0, hidden: 0, formFields: 0, embedded: 0, gradesOrPeople: 0 };
  const out = [];

  const selection = window.getSelection();
  const hasSelection = Boolean(selection && !selection.isCollapsed && selection.toString().trim());
  const useSelection = selectionOnly && hasSelection;
  const ranges = [];
  if (useSelection) {
    for (let i = 0; i < selection.rangeCount; i += 1) ranges.push(selection.getRangeAt(i));
  }

  function isPrivateBlock(el) {
    const names = `${el.id || ''} ${el.getAttribute('class') || ''}`;
    if (names.trim()) {
      const words = names
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/);
      if (words.some((word) => PRIVATE_WORDS.has(word))) return true;
    }
    if (el.tagName === 'TABLE') {
      const headers = Array.from(el.querySelectorAll('th')).slice(0, 30);
      if (headers.some((th) => GRADE_HEADER.test((th.textContent || '').trim()))) return true;
    }
    return false;
  }

  function isVisuallyHidden(el, style) {
    if (style.display === 'none' || style.contentVisibility === 'hidden') return true;
    if (Number(style.opacity) === 0) return true;
    // "Screen-reader only" patterns: clipped to (almost) nothing.
    if (style.position === 'absolute' || style.position === 'fixed') {
      const clipped = (style.clip && style.clip !== 'auto') || (style.clipPath && style.clipPath !== 'none');
      const tiny = el.offsetWidth <= 1 || el.offsetHeight <= 1;
      if (tiny && (clipped || style.overflow === 'hidden')) return true;
    }
    return false;
  }

  function isChrome(el) {
    const tag = el.tagName;
    if (tag === 'HEADER' || tag === 'FOOTER') {
      // A header/footer inside an article or main is content, not site chrome.
      const owner = el.parentElement && el.parentElement.closest('article, main, [role="main"]');
      return !owner;
    }
    return el.matches(CHROME);
  }

  function pushText(node, parentStyle) {
    let value = node.nodeValue || '';
    if (useSelection) {
      let piece = '';
      for (const range of ranges) {
        if (!range.intersectsNode(node)) continue;
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : value.length;
        piece += value.slice(start, end);
      }
      value = piece;
    }
    if (!value) return;
    const pre = parentStyle && /^pre/.test(parentStyle.whiteSpace);
    out.push(pre ? value : value.replace(/\s+/g, ' '));
  }

  function walk(node, parentStyle, parentVisible) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (parentVisible) pushText(node, parentStyle);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    const tag = el.tagName.toUpperCase();

    if (SKIP_CODE.has(tag)) return;
    if (SKIP_FORM.has(tag)) {
      excluded.formFields += 1;
      return;
    }
    if (SKIP_EMBED.has(tag)) {
      excluded.embedded += 1;
      return;
    }
    if (tag === 'BR') {
      out.push('\n');
      return;
    }
    if (el.hidden || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert')) {
      excluded.hidden += 1;
      return;
    }
    // Content of a closed <details> is not rendered.
    const parent = el.parentElement;
    if (parent && parent.tagName === 'DETAILS' && !parent.open && tag !== 'SUMMARY') {
      excluded.hidden += 1;
      return;
    }
    const style = getComputedStyle(el);
    if (isVisuallyHidden(el, style)) {
      excluded.hidden += 1;
      return;
    }
    if (el.isContentEditable) {
      excluded.formFields += 1;
      return;
    }
    if (isChrome(el)) {
      excluded.navigation += 1;
      return;
    }
    if (isPrivateBlock(el)) {
      excluded.gradesOrPeople += 1;
      return;
    }

    // visibility is inherited but can be re-enabled by a child, so it is
    // tracked per element rather than pruning the subtree.
    const visible = style.visibility === 'visible';
    if (!visible && !el.children.length && (el.textContent || '').trim()) excluded.hidden += 1;

    const display = style.display;
    const block = !display.startsWith('inline') && display !== 'contents';
    const separator = PARAGRAPH.has(tag) ? '\n\n' : '\n';
    if (block) out.push(display === 'table-cell' ? ' ' : separator);

    let children = el.childNodes;
    if (el.shadowRoot) children = el.shadowRoot.childNodes;
    else if (tag === 'SLOT' && el.assignedNodes().length) children = el.assignedNodes();
    for (const child of children) walk(child, style, visible);

    if (block) out.push(display === 'table-cell' ? ' \t' : separator);
  }

  let root = document.body;
  if (root && !useSelection) {
    // Prefer the page's single main landmark when it holds real content.
    const mains = document.querySelectorAll('main, [role="main"]');
    if (mains.length === 1 && (mains[0].innerText || '').trim().length >= 200) root = mains[0];
  }
  if (root) {
    const rootStyle = getComputedStyle(root);
    if (root === document.body) {
      for (const child of root.childNodes) walk(child, rootStyle, rootStyle.visibility === 'visible');
    } else {
      walk(root, null, true);
    }
  }

  return {
    url: location.href,
    title: document.title,
    text: out.join(''),
    hasSelection,
    usedSelection: useSelection,
    excluded,
  };
}
