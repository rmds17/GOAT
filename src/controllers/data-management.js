const { DataManagementClient } = require('@aps_sdk/data-management');

const dataManagementClient = new DataManagementClient();


async function getHubs(accessToken) {
  // const hubs = await dataManagementClient.getHubs({ accessToken });
  const response = await fetch('https://developer.api.autodesk.com/project/v1/hubs', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const hubs = await response.json();
  return hubs;
};

async function getProjects(hubId, accessToken) {
  // const projects = await dataManagementClient.getHubProjects(hubId, { accessToken });
  const response = await fetch(`https://developer.api.autodesk.com/project/v1/hubs/${hubId}/projects`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const projects = await response.json();
  return projects;
};

async function getProjectTopFolders(hubId, projectId, accessToken) {
  // const projectTopFolders = await dataManagementClient.getProjectTopFolders(hubId, projectId, { accessToken });
  const response = await fetch(`https://developer.api.autodesk.com/project/v1/hubs/${hubId}/projects/${projectId}/topFolders`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const projectTopFolders = await response.json();
  return projectTopFolders;
};

async function getFolderContents(projectId, folderId, accessToken) {
  // const response = await dataManagementClient.getFolderContents(projectId, folderId, { accessToken });
  const response = await fetch(`https://developer.api.autodesk.com/data/v1/projects/${projectId}/folders/${folderId}/contents`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const folderContents = await response.json();
  return folderContents;
};

async function getItemVersions(projectId, itemId, accessToken) {
  // const itemVersions = await dataManagementClient.getItemVersions(projectId, itemId, { accessToken });
  const response = await fetch(`https://developer.api.autodesk.com/data/v1/projects/${projectId}/items/${itemId}/versions`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const itemVersions = await response.json();
  return itemVersions;
};

module.exports = {
  getHubs,
  getProjects,
  getProjectTopFolders,
  getFolderContents,
  getItemVersions
}