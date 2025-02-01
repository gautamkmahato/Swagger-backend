const express = require('express');
const cors = require('cors');
const $RefParser = require('@apidevtools/json-schema-ref-parser');
const OpenAPISchemaValidator = require('openapi-schema-validator').default;  // OpenAPI validator
const SwaggerParser = require('@apidevtools/swagger-parser');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const jsf = require('json-schema-generator'); // Library to generate JSON Schema from JSON
const swaggerJSDoc = require('swagger-jsdoc');
const ngrok = require("@ngrok/ngrok");


const app = express();

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json({ limit: '10mb' })); // Parse JSON request bodies with a 10MB limit

// Initialize Supabase client
const supabaseUrl = 'https://cgmkehaxaqzfryllepcv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnbWtlaGF4YXF6ZnJ5bGxlcGN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc3OTU4MTIsImV4cCI6MjA1MzM3MTgxMn0.PE4nfhdZE46Z7WSaDRWzXvhsH8MiV1P3-rm5p7_QtSk';
const supabase = createClient(supabaseUrl, supabaseKey);


// Helper Functions

// Function to validate OpenAPI 3.0 JSON data
async function validateOpenApiJson(jsonData) {
    try {
        // Create an OpenAPI 3.0 validator
        const validator = new OpenAPISchemaValidator({
            version: '3.0.0', // specify OpenAPI version 3.0
        });

        // Validate the JSON data against the OpenAPI 3.0 specification
        const result = validator.validate(jsonData);

        // If the validation result is valid, return true
        if (result.errors.length === 0) {
            return { valid: true, errors: [] };
        }

        // If there are errors, return them
        return { valid: false, errors: result.errors };
    } catch (error) {
        // Catch any unexpected errors during validation
        return { valid: false, errors: [error.message] };
    }
}

// async function validateOpenApiSchema(openApiData) {
//   try {
//     await SwaggerParser.validate(openApiData);
//     return { valid: true, errors: [] };
//   } catch (err) {
//     return { valid: false, errors: err };
//   }
// }

/**
 * Validates JSON input against an OpenAPI schema.
 * @param {object} openApiSchema - The OpenAPI schema.
 * @returns {object} - Validation result with `valid` and `errors` properties.
 */
async function validateOpenApiSchema(openApiSchema) {
  try {
    // Validate and dereference the OpenAPI schema
    await SwaggerParser.validate(openApiSchema);

    // If validation succeeds, return no errors
    return {
      valid: true,
      errors: [],
    };
  } catch (err) {
    // If validation fails, extract detailed error messages
    const errors = [];

    if (err.errors) {
      // Handle multiple validation errors
      err.errors.forEach((error) => {
        errors.push({
          message: error.message,
          path: error.path.join('.'),
          schemaPath: error.schemaPath,
          details: error.details,
        });
      });
    } else {
      // Handle single validation error
      errors.push({
        message: err.message,
        path: err.path ? err.path.join('.') : '',
        schemaPath: err.schemaPath || '',
        details: err.details || {},
      });
    }

    return {
      valid: false,
      errors,
    };
  }
}

/**
 * Converts the nested OpenAPI schema into a flattened format.
 * @param {Array} convertedData - The converted OpenAPI data.
 * @returns {Object} - Flattened API data.
 */
async function convertToFlattenedFormat(convertedData) {
  const apiData = {};

  for (const pathObj of convertedData) {
    const [path, methodsArray] = Object.entries(pathObj)[0];
    apiData[path] = {};

    for (const methodObj of methodsArray) {
      const [method, methodData] = Object.entries(methodObj)[0];
      apiData[path][method.toUpperCase()] = methodData;
    }
  }

  return apiData;
}

/**
 * Extracts metadata (paths and methods) from the OpenAPI schema.
 * @param {Object} mySchema - The OpenAPI schema.
 * @returns {Object} - Metadata object.
 */
function getMetaData(mySchema) {
  const myJSON = {};
  const uri = Object.keys(mySchema.paths || {});
  const httpMethods = uri.map((path) => Object.keys(mySchema.paths[path] || {}));

  for (let i = 0; i < uri.length; i++) {
    myJSON[uri[i]] = httpMethods[i];
  }

  return myJSON;
}

/**
 * Converts the OpenAPI schema into a structured format.
 * @param {Object} mySchema - The OpenAPI schema.
 * @returns {Array} - Converted OpenAPI data.
 */
async function convertData(mySchema) {
  try {
    // Dereference the schema to resolve all $refs
    const schema = await $RefParser.dereference(mySchema);

    // Validate schema
    if (!schema.paths || Object.keys(schema.paths).length === 0) {
      throw new Error('Invalid schema: No paths found');
    }

    const myJSON = getMetaData(schema);
    const finalOutput = [];

    for (const x in myJSON) {
      const arr = myJSON[x];
      const methodsData = [];

      for (let i = 0; i < arr.length; i++) {
        const currentMethod = arr[i].toLowerCase();
        if (!schema.paths[x][currentMethod]) {
          console.warn(`Method ${currentMethod} not found for path ${x}`);
          continue;
        }

        const methodDetails = schema.paths[x][currentMethod];

        // Comprehensive response handling
        const responses = methodDetails.responses || {};
        const output = Object.keys(responses)
          .filter((code) => code.startsWith('2'))
          .map((code) => ({
            code,
            content: responses[code].content || {},
            description: responses[code].description || '',
          }));

        // Input handling with improved flexibility
        const input = methodDetails.requestBody?.content || {};

        // Parameters handling
        const parameters = methodDetails.parameters?.map((param) => ({
          name: param.name,
          in: param.in,
          required: param.required,
          description: param.description,
          schema: param.schema,
        })) || [];

        // Error responses handling
        const errorResponses = Object.keys(responses)
          .filter((code) => code.startsWith('4') || code.startsWith('5'))
          .map((code) => ({
            code,
            content: responses[code].content || {},
            description: responses[code].description || '',
          }));

        const obj = {
          [currentMethod]: {
            output,
            input,
            parameters,
            errorResponses,
            operationId: methodDetails.operationId,
            summary: methodDetails.summary,
            description: methodDetails.description,
          },
        };
        methodsData.push(obj);
      }

      const uriObj = {
        [x]: methodsData,
      };
      finalOutput.push(uriObj);
    }

    return finalOutput;
  } catch (err) {
    console.error('Conversion error:', err);
    throw err;
  }
}


/**
 * Enhances the schema with descriptions, examples, and proper array/object handling.
 * @param {Object} data - The raw JSON data.
 * @returns {Object} - The enhanced JSON Schema.
 */
function enhanceSchema(data) {
  const schema = {
    type: 'object',
    properties: {},
    required: [],
  };

  for (const key in data) {
    const value = data[key];
    const property = {};

    // Add description and example
    property.description = `Description for ${key}`;
    property.example = value;

    // Determine the type of the value
    if (Array.isArray(value)) {
      property.type = 'array';
      property.items = {
        type: typeof value[0], // Infer type from the first item in the array
      };
    } else if (typeof value === 'object' && value !== null) {
      property.type = 'object';
      property.properties = enhanceSchema(value).properties; // Recursively handle nested objects
    } else {
      property.type = typeof value;
    }

    schema.properties[key] = property;
    schema.required.push(key);
  }

  return schema;
}

/**
/**
 * Converts raw input JSON, output JSON, and parameters into an OpenAPI 3.0 schema.
 * @param {Object} rawInput - The raw input JSON.
 * @param {Object} rawOutput - The raw output JSON.
 * @param {Array} parameters - The parameters (query, path, header, etc.).
 * @returns {Object} - The OpenAPI 3.0 schema.
 */
async function generateOpenAPISchema(rawInput, rawOutput, parameters) {
  // Generate enhanced JSON Schema from raw input and output
  const inputSchema = enhanceSchema(rawInput);
  const outputSchema = enhanceSchema(rawOutput);

  const openapiDefinition = {
    openapi: '3.0.0',
    info: {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Automatically generated OpenAPI 3.0 schema',
    },
    paths: {
      '/example-endpoint': {
        post: {
          summary: 'Example endpoint',
          description: 'This is an example endpoint',
          parameters: parameters,
          requestBody: {
            description: 'Input payload',
            content: {
              'application/json': {
                schema: inputSchema,
              },
            },
            required: true,
          },
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: outputSchema,
                },
              },
            },
          },
        },
      },
    },
  };

  return openapiDefinition;
}



// POST Endpoint
app.post('/convert', async (req, res) => {
  try {
    //console.log('Request Headers:', req.headers); // Log headers
    //console.log('Request Body:', req.body); // Log body

    const { body } = req;

    if (!body || Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'No data provided' });
    }

    // Validate the incoming JSON data to ensure it's OpenAPI 3.0
    // const validation = await validateOpenApiJson(body);
    // console.log(validation)
    // if (validation.errors.length > 0) {
    //     // If the JSON is invalid, respond with an error
    //     return res.status(400).json({
    //         err: `Invalid OpenAPI 3.0 specification: ${validation.errors.join(', ')}`
    //     });
    // }

    // const validationResult = await validateOpenApiSchema(body);
    // console.log(validationResult)
    // if (validationResult.valid) {
    //   console.log("The input data is a valid OpenAPI 3.0 specification.");
    // } else {
    //     console.error("The input data is NOT valid. Errors:", validationResult.errors);
    //     return res.status(400).json({
    //         err: `Invalid OpenAPI 3.0 specification: ${validationResult.errors}`
    //     });
    // }

    const validationResult = await validateOpenApiSchema(body);
    console.log(validationResult)

    if (!validationResult.valid) {
      return res.status(400).json({
        error: 'Invalid OpenAPI schema',
        details: validationResult.errors[0].message,
      });
    }


    // Convert the OpenAPI schema
    const convertedData = convertData(body);
    const ans = await convertToFlattenedFormat(convertedData);

    return res.status(200).json({ ans });
  } catch (err) {
    console.error('Error processing request:', err);
    return res.status(500).json({
      error: `Error processing request: ${err instanceof Error ? err.message : 'Unknown error'}`,
    });
  }
});

app.post('/convert/openapi', async (req, res) => {
  try {
    const { input, output, parameters } = req.body;
    console.log('Input:', input);
    console.log('Output:', output);
    console.log('Parameters:', parameters);

    if (!input || !output || !parameters || Object.keys(input).length === 0 || Object.keys(output).length === 0) {
      return res.status(400).json({ error: 'No data provided' });
    }

    const openapiSchema = await generateOpenAPISchema(input, output, parameters);
    console.log('Generated OpenAPI Schema:', JSON.stringify(openapiSchema, null, 2));

    return res.status(200).json({ openapiSchema });

  } catch (err) {
    console.error('Error processing request:', err);
    return res.status(500).json({
      error: `Error processing request: ${err instanceof Error ? err.message : 'Unknown error'}`,
    });
  }
});

// Example route to fetch data from Supabase
app.get('/api', async (req, res) => {
    
    try {
        
        let { data, error } = await supabase
        .from('users')
        .select('*')
                
    
        if (error) {
          console.error('Supabase Error:', error);
          res.status(500).json({ error: error.message });
        } else {
          console.log('Data:', data);
          res.json(data);
        }
      } catch (err) {
        console.error('Fetch Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
      }

});

app.get('/api/v1/projects', async (req, res) => {
    
    let { data, error } = await supabase
    .from('projects')
    .select('*')
            
    if (error) {
      return res.status(500).json({ error: error.message });
    }
  
    res.json(data);
});

app.post('/api/v1/projects/add', async (req, res) => {
  const { project_name, description, user_id } = req.body;

  console.log(project_name);
  console.log(description);

  try {
    const { data, error } = await supabase
      .from('projects')
      .insert([
        { project_name: project_name, description: description, user_id: user_id }
      ])
      .select();

    if (error) {
      console.error('Supabase Error:', error);
      return res.status(500).json({ error: error.message });
    } else {
      console.log('Data:', data);
      return res.json(data);
    }
  } catch (err) {
    console.error('Fetch Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.get('/api/v1/documentations', async (req, res) => {
    
  let { data, error } = await supabase
  .from('apidocumentation')
  .select('*')
          
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

app.get('/api/v1/documentations/:projectId', async (req, res) => {

  const projectId = req.params.projectId;
    
  let { data, error } = await supabase
  .from('apidocumentation')
  .select("*")

  // Filters
  .eq('project_id', projectId)
          
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

app.post('/api/v1/documentations/add', async (req, res) => {
  const { project_id, title, description } = req.body;

  console.log(title);
  console.log(description);

  try {
    const { data, error } = await supabase
      .from('apidocumentation')
      .insert([
        { project_id: project_id, title: title, description: description }
      ])
      .select();

    if (error) {
      console.error('Supabase Error:', error);
      return res.status(500).json({ error: error.message });
    } else {
      console.log('Data:', data);
      return res.status(201).json(data);
    }
  } catch (err) {
    console.error('Fetch Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/v1/documentation/:docId/schema', async (req, res) => {

  const docId = req.params.docId;
    
  let { data, error } = await supabase
  .from('apidocumentation')
  .select("*")

  // Filters
  .eq('api_id', docId)
          
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

app.post('/api/v1/documentations/:docId/add/schema', async (req, res) => {
  const docId = req.params.docId;
  const apiData = req.body;

  console.log(apiData);

  try {
    
    const { data, error } = await supabase
      .from('apidocumentation')
      .update({ openapi_schema: apiData })
      .eq('api_id', docId)
      .select()
            

    if (error) {
      console.error('Supabase Error:', error);
      return res.status(500).json({ error: error.message });
    } else {
      console.log('Data:', data);
      return res.status(201).json(data);
    }
  } catch (err) {
    console.error('Fetch Error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/test', async (req, res) => {
  const { url, apikey, Authorization, input } = req.body;

  try {
    const headers = {
      'Content-type': 'application/json',
      'apikey': apikey,
      'Authorization': Authorization,
    };

    const response = await axios.get(url, { headers });
    console.log('Data:', response.data);
    res.json(response.data);

  } catch (error) {
    console.error('Axios Error:', {
      message: error.message,
      code: error.code,
      response: error.response?.data,
    });
    res.status(500).json({ error: 'Internal Server Error' });
  }
});



// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, async() => {
  console.log(`Server is running on http://localhost:${PORT}`);
  // Establish connectivity
  const listener = await ngrok.forward({ addr: 8080, '2qQCvNqgw5JMFnVbGmpuhY0liWS_LCriAhkbCC15frDVnbre': true });

  // Output ngrok url to console
  console.log(`Ingress established at: ${listener.url()}`);
});