const express = require("express");
const axios = require("axios");
const XLSX = require("xlsx");
const app = express();
const path = require("path");
const PORT = 3000;
const admin = require("firebase-admin");
const multer = require("multer");
const upload = multer({ dest: "uploads/" }); // Multer for handling file uploads
const fs = require("fs");

// Initialize Firebase Admin with service account
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "ethicalcodes-33f87.appspot.com",
});

const bucket = admin.storage().bucket();

// Helper function to download the Excel file from Firebase Storage
const downloadExcelFile = async () => {
  const tempFilePath = path.join(__dirname, "Codes.xlsx");
  const file = bucket.file("Codes.xlsx");

  await file.download({ destination: tempFilePath });
  console.log(`Downloaded Codes.xlsx to ${tempFilePath}`);

  return tempFilePath;
};

// Handle form submission and file upload
app.get("/addFile", (req, res) => {
  res.sendFile(path.join(__dirname, "add.html"));
});
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.post("/uploadFile", upload.single("file"), async (req, res) => {
  try {
    const {
      documentName,
      entityName,
      location,
      region,
      year,
      sector,
      values,
      fileLink,
    } = req.body;
    const file = req.file; // Uploaded file

    // Download Excel file from Firebase Storage
    const excelFilePath = await downloadExcelFile();

    // Read the Excel file
    const workbook = XLSX.readFile(excelFilePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    const newId = data.length ? data[data.length - 1].ID + 1 : 1;

    let fileUrl = fileLink;

    if (file) {
      // Ensure the file is found and accessible
      const filePath = path.join(__dirname, file.path);

      // Upload file to Firebase Storage
      const firebaseFile = bucket.file(`${newId}.pdf`);

      // Create a write stream to Firebase Storage
      const stream = firebaseFile.createWriteStream({
        metadata: {
          contentType: "application/pdf",
        },
      });

      // Read the file from the local file system and pipe it to Firebase Storage
      fs.createReadStream(filePath)
        .on("error", (err) => {
          console.error("Error reading file:", err);
          return res.status(500).json({
            success: false,
            message: "Error reading file from disk: " + err.message,
          });
        })
        .pipe(stream)
        .on("error", (err) => {
          console.error("Error uploading to Firebase:", err);
          return res.status(500).json({
            success: false,
            message: "Error uploading file to Firebase: " + err.message,
          });
        })
        .on("finish", async () => {
          // Generate a signed URL for the file in Firebase Storage
          try {
            const [signedUrl] = await firebaseFile.getSignedUrl({
              action: "read",
              expires: "03-01-2025",
            });
            fileUrl = signedUrl;

            // Clean up the uploaded file from local storage
            fs.unlinkSync(filePath);

            // Update Excel file with new row
            const newRow = {
              ID: newId,
              "Document name": documentName,
              "Entity name": entityName,
              Location: location,
              Region: region,
              Year: year,
              Sector: sector,
              "File URL": fileUrl, // Store the file URL (either from upload or link)
              ...values.reduce((acc, value) => ({ ...acc, [value]: "X" }), {}),
            };
            data.push(newRow);
            const newSheet = XLSX.utils.json_to_sheet(data);
            workbook.Sheets[workbook.SheetNames[0]] = newSheet;
            XLSX.writeFile(workbook, excelFilePath);

            // Upload the updated Excel file back to Firebase Storage
            await bucket.upload(excelFilePath, {
              destination: "Codes.xlsx",
            });

            return res.json({
              success: true,
              message: "File uploaded and data saved successfully!",
            });
          } catch (err) {
            return res.status(500).json({
              success: false,
              message: "Error generating signed URL: " + err.message,
            });
          }
        });
    } else {
      if (!fileUrl) {
        return res.status(400).json({
          success: false,
          message: "Please provide a file or a link.",
        });
      }

      // Save file link to Excel file
      const newRow = {
        ID: newId,
        "Document name": documentName,
        "Entity name": entityName,
        Location: location,
        Region: region,
        Year: year,
        Sector: sector,
        "File URL": fileUrl, // Store the file URL (either from upload or link)
        ...values.reduce((acc, value) => ({ ...acc, [value]: "X" }), {}),
      };
      data.push(newRow);
      const newSheet = XLSX.utils.json_to_sheet(data);
      workbook.Sheets[workbook.SheetNames[0]] = newSheet;
      XLSX.writeFile(workbook, excelFilePath);

      // Upload the updated Excel file back to Firebase Storage
      await bucket.upload(excelFilePath, {
        destination: "Codes.xlsx",
      });

      return res.json({
        success: true,
        message: "Link added and data saved successfully!",
      });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error uploading file/link: " + error.message,
    });
  }
});

// API endpoint to filter documents
app.get("/api/documents", async (req, res) => {
  try {
    // Download Excel file from Firebase Storage
    const excelFilePath = await downloadExcelFile();

    // Read the Excel file
    const workbook = XLSX.readFile(excelFilePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    // Apply filters
    let filteredData = data;
    const filters = req.query;

    if (filters.name) {
      filteredData = filteredData.filter(
        (doc) =>
          doc["Document name"]
            .toLowerCase()
            .includes(filters.name.toLowerCase()) ||
          doc["Entity name"].toLowerCase().includes(filters.name.toLowerCase())
      );
    }
    if (filters.region) {
      const regionFilter = filters.region.toLowerCase();
      filteredData = filteredData.filter((doc) => {
        const location = doc["Location"] ? doc["Location"].toLowerCase() : "";
        const region = doc["Region"] ? doc["Region"].toLowerCase() : "";
        return location.includes(regionFilter) || region.includes(regionFilter);
      });
    }
    if (filters.year) {
      filteredData = filteredData.filter((doc) => doc["Year"] == filters.year);
    }
    if (filters.sector && filters.sector != "none") {
      filteredData = filteredData.filter(
        (doc) => doc["Sector"] === filters.sector
      );
    }
    if (filters.values) {
      const values = Array.isArray(filters.values)
        ? filters.values
        : [filters.values];
      filteredData = filteredData.filter((doc) =>
        values.every((value) => doc[value] === "X")
      );
    }

    res.json(filteredData);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error reading Excel file: " + error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
