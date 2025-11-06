 async function checkAuthStatus() {
            try {
                const response = await fetch('/api/auth/profile');
                
                const statusEl = document.getElementById('authStatus');
                const userNameEl = document.getElementById('userName');
                const userNameValueEl = document.getElementById('userNameValue');
                const loginBtn = document.getElementById('loginBtn');
                const logoutBtn = document.getElementById('logoutBtn');

                if (response.ok) {
                    const data = await response.json();
                    statusEl.textContent = 'Authenticated';
                    userNameValueEl.textContent = data.name;
                    userNameEl.classList.remove('hidden');
                    loginBtn.classList.add('hidden');
                    logoutBtn.classList.remove('hidden');
                } else {
                    statusEl.textContent = 'Not authenticated';
                    userNameEl.classList.add('hidden');
                    loginBtn.classList.remove('hidden');
                    logoutBtn.classList.add('hidden');
                }
            } catch (error) {
                document.getElementById('authStatus').textContent = 'Error';
                document.getElementById('loginBtn').classList.remove('hidden');
            }
        }

        checkAuthStatus();

function initViewer() {
    Autodesk.Viewing.Initializer(options, function() {
    // Get the div where the viewer will be placed
    var containerDiv = document.getElementById('viewerContainer');
    
    // Instantiate the viewer on the div
    var viewer = new Autodesk.Viewing.GuiViewer3D(containerDiv);
    // Initialize the viewer
    viewer.start();
    });
 } 