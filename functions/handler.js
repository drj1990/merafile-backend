const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const dynamo = new AWS.DynamoDB.DocumentClient();
const BUCKET = process.env.BUCKET_NAME;
const TABLE = process.env.SHORT_LINKS_TABLE;
const { v4: uuidv4 } = require("uuid");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // Change "*" to your frontend domain if needed
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
};

// Handle preflight OPTIONS requests (for API Gateway proxy integration)
const handleOptions = () => {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: "",
  };
};

// Function for generating signed upload URL
module.exports.upload = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { files, expiresIn = 3600 } = body;

    if (!Array.isArray(files) || files.length === 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: "No files provided." }),
      };
    }

    const sessionId = uuidv4(); // Generate a session ID
    const now = Date.now();
    const domain = event.headers.Host;
    const protocol = event.headers["X-Forwarded-Proto"] || "https";

    const results = [];

    for (let file of files) {
      const { fileName, contentType, fileSize } = file;
      const shortCode = Math.random().toString(36).substring(2, 10);
      const s3Key = `uploads/${shortCode}-${fileName}`;

      const params = {
        Bucket: BUCKET,
        Key: s3Key,
        ContentType: contentType,
        Expires: expiresIn,
      };

      const uploadUrl = s3.getSignedUrl("putObject", params);
      const shortUrl = `${protocol}://${domain}/file/${shortCode}/view`;

      // Save file record in DB
      await dynamo
        .put({
          TableName: TABLE,
          Item: {
            sessionId,
            shortcode: shortCode,
            fileName,
            s3Key,
            createdAt: now,
            expiresIn,
            fileSize,
            status: "pending", // To be updated later if needed
          },
        })
        .promise();

      results.push({
        fileName,
        uploadUrl,
        shortUrl,
        shortCode,
      });
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        sessionId,
        files: results,
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

module.exports.updateUploadStatus = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { sessionId, shortcode, status } = body;

    if (!sessionId || !shortcode || !status) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: "Missing sessionId, shortcode or status",
        }),
      };
    }

    await dynamo
      .update({
        TableName: TABLE,
        Key: {
          sessionId,
          shortcode,
        },
        UpdateExpression: "SET #status = :status",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":status": status,
        },
      })
      .promise();

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: "Status updated successfully" }),
    };
  } catch (err) {
    console.error("Error updating status", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

// Function to generate download URL
module.exports.generateDownloadUrl = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return handleOptions();
  }

  const { key } = event.queryStringParameters;

  const params = {
    Bucket: BUCKET,
    Key: key,
    Expires: 600,
  };

  const downloadUrl = s3.getSignedUrl("getObject", params);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ downloadUrl }),
  };
};

// Function to view files for a session
module.exports.viewFile = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return handleOptions();
  }

  const sessionId = event.queryStringParameters?.sessionId;
  if (!sessionId) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: "Missing sessionId" }),
    };
  }

  try {
    // 1. Query DynamoDB for all items under the sessionId (partition key)
    const result = await dynamo
      .query({
        TableName: TABLE,
        KeyConditionExpression: "sessionId = :sid",
        ExpressionAttributeValues: {
          ":sid": sessionId,
        },
      })
      .promise();

    const items = result.Items;

    if (!items || items.length === 0) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({ message: "No files found for this session" }),
      };
    }

    const now = Date.now();

    // 2. Generate signed URLs and build response
    const responseData = items.map((item) => {
      const expiryTime = item.createdAt + item.expiresIn * 1000;
      const expired = now > expiryTime;

      const signedUrl = expired
        ? null
        : s3.getSignedUrl("getObject", {
            Bucket: BUCKET,
            Key: item.s3Key,
            Expires: 600,
          });

      return {
        fileName: item.fileName,
        s3Key: item.s3Key,
        shortcode: item.shortcode,
        createdAt: item.createdAt,
        expiresIn: item.expiresIn,
        fileSize: item.fileSize,
        expired,
        signedUrl,
      };
    });

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(responseData),
    };
  } catch (error) {
    console.error("Error retrieving files for session:", error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: "Internal server error" }),
    };
  }
};
