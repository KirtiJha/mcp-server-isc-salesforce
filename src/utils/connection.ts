import jsforce from 'jsforce';
import { ConnectionType, ConnectionConfig } from '../types/connection.js';
import https from 'https';
import querystring from 'querystring';

/**
 * Creates a Salesforce connection using either username/password or OAuth 2.0 Client Credentials Flow
 * @param config Optional connection configuration
 * @returns Connected jsforce Connection instance
 */
export async function createSalesforceConnection(config?: ConnectionConfig) {
  // Determine connection type from environment variables or config
  const connectionType = config?.type || 
    (process.env.SALESFORCE_CONNECTION_TYPE as ConnectionType) || 
    ConnectionType.User_Password;
  
  // Set login URL from config or environment variable
  const loginUrl = config?.loginUrl || 
    process.env.SALESFORCE_INSTANCE_URL || 
    'https://login.salesforce.com';
  
  try {
    if (connectionType === ConnectionType.OAuth_2_0_Client_Credentials) {
      // OAuth 2.0 Client Credentials Flow
      const clientId = process.env.SALESFORCE_CLIENT_ID;
      const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;
      
      if (!clientId || !clientSecret) {
        throw new Error('SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET are required for OAuth 2.0 Client Credentials Flow');
      }
      
      console.error('Connecting to Salesforce using OAuth 2.0 Client Credentials Flow');
      
      // Get the instance URL from environment variable or config
      const instanceUrl = loginUrl;
      
      // Create the token URL
      const tokenUrl = new URL('/services/oauth2/token', instanceUrl);
      
      // Prepare the request body
      const requestBody = querystring.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      });
      
      // Make the token request
      const tokenResponse = await new Promise<any>((resolve, reject) => {
        const req = https.request({
          method: 'POST',
          hostname: tokenUrl.hostname,
          path: tokenUrl.pathname,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(requestBody)
          }
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const parsedData = JSON.parse(data);
              if (res.statusCode !== 200) {
                reject(new Error(`OAuth token request failed: ${parsedData.error} - ${parsedData.error_description}`));
              } else {
                resolve(parsedData);
              }
            } catch (e: unknown) {
              reject(new Error(`Failed to parse OAuth response: ${e instanceof Error ? e.message : String(e)}`));
            }
          });
        });
        
        req.on('error', (e) => {
          reject(new Error(`OAuth request error: ${e.message}`));
        });
        
        req.write(requestBody);
        req.end();
      });
      
      // Create connection with the access token
      const conn = new jsforce.Connection({
        instanceUrl: tokenResponse.instance_url,
        accessToken: tokenResponse.access_token,
        version: '59.0'  // Explicitly set API version
      });
      
      // Test the connection to ensure it's working
      console.error('Testing Salesforce OAuth connection...');
      await conn.query('SELECT Id FROM User LIMIT 1');
      console.error('Salesforce OAuth connection test successful');
      
      return conn;
      
      return conn;
    } else {
      // Default: Username/Password Flow with Security Token
      const username = process.env.SALESFORCE_USERNAME;
      const password = process.env.SALESFORCE_PASSWORD;
      const token = process.env.SALESFORCE_TOKEN;
      
      if (!username || !password) {
        throw new Error('SALESFORCE_USERNAME and SALESFORCE_PASSWORD are required for Username/Password authentication');
      }
      
      console.error('Connecting to Salesforce using Username/Password authentication');
      
      // Create connection with login URL
      const conn = new jsforce.Connection({ 
        loginUrl,
        version: '59.0'  // Explicitly set API version
      });
      
      await conn.login(
        username,
        password + (token || '')
      );
      
      // Test the connection to ensure it's working
      console.error('Testing Salesforce connection...');
      await conn.query('SELECT Id FROM User LIMIT 1');
      console.error('Salesforce connection test successful');
      
      return conn;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Handle specific HTTP 405 error
    if (errorMessage.includes('405') && errorMessage.includes('Only POST allowed')) {
      console.error('HTTP 405 error detected. This usually indicates an API version or endpoint issue.');
      console.error('Trying with a different API version...');
      
      try {
        // Try with an older API version
        const conn = new jsforce.Connection({ 
          loginUrl,
          version: '58.0'
        });
        
        await conn.login(
          process.env.SALESFORCE_USERNAME!,
          process.env.SALESFORCE_PASSWORD! + (process.env.SALESFORCE_TOKEN || '')
        );
        
        console.error('Successfully connected with API version 58.0');
        return conn;
      } catch (retryError) {
        console.error('Retry with API version 58.0 also failed:', retryError);
      }
    }
    
    console.error('Error connecting to Salesforce:', error);
    throw error;
  }
}