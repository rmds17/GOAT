# APS Viewer Setup Guide

To get the 3D viewer working with Autodesk Platform Services (APS):

## 1. Get APS Credentials

1. Go to [Autodesk Developer Console](https://developer.autodesk.com)
2. Create an app and get your:
   - **Client ID**
   - **Client Secret**

## 2. Configure Environment Variables

Edit `.env` file in the project root:

```env
APS_CLIENT_ID=your_client_id_here
APS_CLIENT_SECRET=your_client_secret_here
AIRTABLE_API_KEY=your_airtable_api_key_here
AIRTABLE_BASE_ID=your_base_id_here
AIRTABLE_TABLE_WORKORDERS=WorkOrders
```

## 3. Prepare a Model

To load a 3D model in the viewer, you need:
- A model file (IFC, Revit, etc.)
- Upload it to APS to get a URN (Uniform Resource Name)
- Use `loadModel(urn)` function to display it

## 4. Start Server

```powershell
cd "C:\Users\fidin\Documents\GitHub\GOAT"
& "C:\Program Files\nodejs\node.exe" server.js
```

Then open: `http://localhost:3001`

## Features

- **3D Viewer**: Click on elements to select them for work orders
- **Work Orders (OT)**: Create, update, delete maintenance orders linked to building elements
- **Element Selection**: Automatically captures GlobalId and Type when you select 3D objects

## API Endpoints

- `GET /api/aps/token` - Get authentication token for viewer
- `GET /api/workorders` - List all work orders
- `POST /api/workorders` - Create new work order
- `PATCH /api/workorders/:id` - Update work order
- `DELETE /api/workorders/:id` - Delete work order
