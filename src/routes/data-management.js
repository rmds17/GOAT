const express = require('express');
const { authRefreshMiddleware } = require('../middlewares/auth.js');
const {
  getHubs,
  getProjects,
  getProjectTopFolders,
  getFolderContents,
  getItemVersions
} = require('../controllers/data-management.js');

let router = express.Router();

router.use('/api/dm', authRefreshMiddleware);

router.get('/api/dm/hubs', async function (req, res) {
  const accessToken = req.internalOAuthToken.access_token; // We need to retrieve this token from the session and use it when calling the APS API
  
  try {
      const hubs = await getHubs(accessToken);
      // const hubsInfo = [];
      // for (const hub of hubs) {
      //   const hubInfo = { id: hub.id, name: hub.attributes.name };
      //   hubsInfo.push(hubInfo);
      // }
      // res.json(hubsInfo);
      res.json(hubs);
    } catch (err) {
      throw err;
    }
});

router.get('/api/dm/hubs/:hub_id/projects', async function (req, res, next) {
  const { hub_id } = req.params;
  const accessToken = req.internalOAuthToken.access_token; // We need to retrieve this token from the session and use it when calling the APS API

  try {
    const projects = await getProjects(hub_id, accessToken);
    // const projectsInfo = [];
    // for (const project of projects) {
    //   const projectInfo = { id: project.id, name: project.attributes.name };
    //   projectsInfo.push(projectInfo);
    // }
    // res.json(projectsInfo);
    res.json(projects);
  } catch (err) {
    throw err;
  }
});

router.get('/api/dm/hubs/:hub_id/projects/:project_id/contents', async function (req, res) {
  const { hub_id, project_id } = req.params;
  const accessToken = req.internalOAuthToken.access_token; // We need to retrieve this token from the session and use it when calling the APS API

  try {
      const entries = await getProjectTopFolders(hub_id, project_id, accessToken);
      res.json(entries);
  } catch (err) {
      throw err;
  }
});

router.get('/api/dm/hubs/:hub_id/projects/:project_id/folders/:folder_id', async function (req, res) {
  const { hub_id, project_id, folder_id } = req.params;
  const encodedUrn = encodeURIComponent(folder_id);

  const accessToken = req.internalOAuthToken.access_token; // We need to retrieve this token from the session and use it when calling the APS API
  
  try {
      const entries = await getFolderContents(project_id, encodedUrn, accessToken);
      res.json(entries);
  } catch (err) {
      throw err;
  }
});

router.get('/api/dm/hubs/:hub_id/projects/:project_id/contents/:item_id/versions', async function (req, res, next) {
  const { project_id, item_id } = req.params;
  const accessToken = req.internalOAuthToken.access_token; // We need to retrieve this token from the session and use it when calling the APS API

  try {
      const versions = await getItemVersions(project_id, item_id, accessToken);
      res.json(versions);
  } catch (err) {
      throw err;
  }
});


module.exports = router;