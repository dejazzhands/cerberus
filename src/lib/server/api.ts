/**
 * @file api.ts
 * This file is the "business logic" for this app.
 * LDAP interfacing, Session Management etc.
 */
/// <reference path="api.d.ts" />
import { TOKEN, LDAP_USER, LDAP_PASS, LDAP_URL } from '$env/static/private';
import * as jose from 'jose';

/** @ts-ignore */
import * as ldapjs from 'ldapjs';
import * as util from './util';

console.log('api.ts loaded!'); // Professionall Debugging

// Wait I'm supposed to hate OO?

/**
 * @class ldap_class
 * Functions related to Ldap read/write
 * This class should *only* contain static methods
 */
class ldap_class {
	private client: Api.LdapClient;
	private client_user: Api.LdapClient;
	private error: boolean;
	/**
	 * @method status
	 * @returns true if no error.
	 */
	public get status() {
		return !this.error;
	}
	/**
	 *
	 *
	 * UPDATE:
	 * It is best practice to bind as the user to
	 * authenticate! `client` is our client for admin
	 * ops, client_user is for binding.
	 * NOTE:
	 * Connecting here makes the first load very slow!
	 */
	constructor() {
		console.log('Attempting LDAP contact...');
		this.error = false;
		this.client = this._connect();
		this.client_user = this._connect();

		this.client.bind(LDAP_USER, LDAP_PASS, (err: any) => {
			this.error = err !== null;
		});
	}

	private _connect(): Api.LdapClient {
		const cl = ldapjs.createClient({
			url: [LDAP_URL],
			reconnect: true
		});
		/** @todo Better Error Reporting */
		cl.on('error', (err: any) => {
			this.error = err !== null;
		});
		return cl;
	}

	/**
	 * @function validateUser
	 * This function is the single source of truth
	 * for User Authentication!
	 *
	 * @param {string} user
	 * @param {string} password
	 * @return {Promise<Result>}
	 * @desc: This function should check if the username and password
	 *           exist in the ActiveDirectory (interfaced with LDAP.js)
	 */
	async validateUser(user?: string, password?: string): Promise<Api.Result> {
		console.log('validateUser called!');
		console.log(`Bound? ${this.error}`);
		// if (username === 'ACM' && password === 'testing') {
		//	return { error: 0, message: '' };
		// } else {
		//	return { error: 1, message: 'Error!' };
		// }
		console.log(`Attempting to bind as user ${user}`);
		if (!user || !password) {
			return { error: true, message: `validateUser: no username or password given` };
		}
		let success = await util._bind(this.client_user, user, password);
		console.log(`Returning Success ${success}`);
		return { error: !success, message: '' };
	}

	/**
	 * @function change_password
	 * @todo: Implement this function!
	 * @param {string} user
	 * @param {string} newpass
	 * @return {Promise<Result>}
	 * @desc
	 * User's password is changed to newpass.
	 * Notes:
	 * Need to BIND to LDAP with a service user (we already have one)
	 * This function will need to consume a secret.
	 * This **MUST** be done with an environment variable. (.env file)
	 * Use instance variables in this class.
	 * Ideally, bind when the class is created.
	 * DO NOT ATTEMPT IF U DONT KNOW WHAT YOU ARE DOING
	 */
	change_password(user: string, newpass: string): Api.Result {
		console.log('change_password called!');
		return { error: false, message: '' };
	}
}

/**
 * @class session_class
 * Functions related to cookies and session management
 */
class session_class {
	/**
	 * @desc
	 * Contains the JWT signing secret
	 * Leaking this will allow anyone to fake any user!
	 */
	private secret: Uint8Array;

	constructor() {
		this.secret = new TextEncoder().encode(TOKEN);
	}

	/**
	 * @function @static create_session_string
	 * @desc Issues a JWT to the user
	 * This function **must** be called only after authentication!
	 */
	async create_session_string(username: string): Promise<string> {
		// return username === 'ACM' ? 'ABCXYZ69420' : username;
		const jwt = await new jose.SignJWT({ username })
			.setProtectedHeader({ alg: 'HS256' })
			.setIssuedAt()
			.setIssuer('acmlug')
			.setAudience('acmlug')
			.setExpirationTime('2h')
			.sign(this.secret);
		console.log(`Created JWT for ${username}: \n ${jwt}`);
		return jwt;
	}

	/**
	 * @function get_session_string
	 * @see {@link create_session_string}
	 * @desc Validates the JWT presented by the client
	 * Scaling: This function will be called quite a lot of times.
	 */
	async get_session_string(cookie?: string): Promise<string | null> {
		// return cookie === 'ABCXYZ69420' ? 'ACM' : null;
		if (!cookie) {
			return null;
		}
		try {
			const { payload } = await jose.jwtVerify(cookie, this.secret, {
				issuer: 'acmlug',
				audience: 'acmlug'
			});
			// console.log(`Header:${protectedHeader}\nPayload:${payload}`);
			// @ts-ignore
			return payload.username;
		} catch (e) {
			console.log(`JWT Verification Failed E: ${e} Cookie: ${cookie}`);
			return null;
		}
	}
}

// Exports
const ldap = new ldap_class();
const session = new session_class();

export {ldap, session};
