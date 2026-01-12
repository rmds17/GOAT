const { JSDOM } = require('jsdom');

(async () => {
  const dom = await JSDOM.fromURL('http://localhost:3001', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true
  });

  dom.window.addEventListener('load', () => {
    setTimeout(() => {
      const list = dom.window.document.getElementById('wo-list');
      console.log('wo-list innerHTML:', list ? list.innerHTML : '[missing]');
      dom.window.close();
    }, 5000);
  });
})();
