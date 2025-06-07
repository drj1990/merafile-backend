const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const BUCKET = process.env.BUCKET_NAME;

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
    return handleOptions();
  }

  const body = JSON.parse(event.body);
  const { fileName, contentType } = body;

  const params = {
    Bucket: BUCKET,
    Key: fileName,
    ContentType: contentType,
    Expires: 600,
  };

  const uploadUrl = s3.getSignedUrl("putObject", params);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ uploadUrl }),
  };
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
