// import { TOKEN, LDAP_USER, LDAP_PASS, LDAP_URL } from '$env/dynamic/private';
import { env } from '$env/dynamic/private';
import * as jose from 'jose';

// @ts-ignore
import ldapjs from 'ldapjs';
import * as util from './util';
import * as Api from './my-types';
import type { TlsOptions } from 'tls';

console.log('api.ts loaded!'); // Professionall Debugging

// Wait I'm supposed to hate OO?

let { TOKEN, LDAP_USER, LDAP_PASS, LDAP_URL } = env;

/**
 * @class ldap_class
 * @remarks
 * This class represents the state of the LDAP connection.
 * Exposes functions which perform LDAP read/writes/binds.
 */
export class ldap_class {
	// private client?: Api.LdapClient;
	private error: boolean;
	private tls: boolean;
	/**
	 * @method status
	 * @returns true if no error has occured in ldap.
	 */
	public get status() {
		return !this.error;
	}
	/**
	 * @remarks
	 * It is best practice to bind as the user to
	 * authenticate! `client` is our client for admin
	 * ops, client_user is for binding.
	 * NOTE:
	 * Connecting here makes the first load very slow!
	 */
	constructor() {
		console.log('Attempting LDAP contact...');
		this.error = false;
		// this.client = this._connect();
		this.tls = false;
	}

	/** @todo Add acmuic.org ldaps cert here */
	private _connect(): Api.LdapClient {
		const opts = {
			rejectUnauthorized: false,
		} satisfies TlsOptions;
		const cl = ldapjs.createClient({
			url: [LDAP_URL!],
			reconnect: true,
			tlsOptions: opts
		});
		/** @todo Better Error Reporting */
		cl.on('error', (err: any) => {
			this.error = err !== null;
		});

		return cl;
	}

	private _get_client(): Api.LdapClient {
		let cl = this._connect();
		cl.bind(LDAP_USER, LDAP_PASS, (err: any) => {
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
	 * @remarks This function should check if the username and password
	 *          exist in the ActiveDirectory (interfaced with LDAP.js)
	 */
	async validateUser(user?: string, password?: string): Promise<Api.Result> {
		console.log('validateUser called!');
		console.log(`Bound? ${this.error}`);
		console.log(`Attempting to bind as user ${user}`);
		let client_user = this._connect();
		let message: string = "";
		let success: boolean = false;
		if (!user || !password) {
			return { error: true, message: `validateUser: no username or password given` };
		}
		try {
			success = await util._bind(client_user, user, password);
		} catch (e: any) {
			message = e;
			success = false;
		}
		client_user.unbind();
		console.log(`Returning Success ${success}`);
		return { error: !success, message };
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
	async change_password(user: string, oldpass: string,
		newpass: string): Promise<Api.Result> {
		console.log(`change_password: oldpass: ${oldpass}`);
		let success: boolean;
		let message: string = "";
		let client = this._get_client();
		const change = new ldapjs.Change({
			operation: 'replace',
			modification: new ldapjs.Attribute({
				'type': 'userPassword',
				'values': [newpass]
			})
		});
		try {
			let bind_err = await this.validateUser(user, oldpass);
			if (bind_err.error) {
				throw new Error("Old password Wrong!");
			}
			let dn = (await this.get_member_info(user)).distinguishedName;
			success = await util._modify(client, dn, change);
			console.log(`Modify would have been called!`);
			success = true;
		} catch (e: any) {
			console.log(`Error in change_password: ${e}`)
			success = false;
			message = e.toString();
		}
		return { error: !success, message };
	}

	/**
	 * This function should fetch information from LDAP for the current user.
	 * List of information fetched (subject to change):
	 * 1. cn
	 * 2. badPasswordTime [password expiry]
	 * 3. description
	 * 4. memberOf
	 *
	 * Filtering on `userPrincipalName` which is in the form
	 * <username>@acmuic.org
	 * @todo Make the filter a ENV Var.
	 */
	async get_member_info(username: string): Promise<Api.MemberInfo> {
		let client = this._get_client();
		const opts = {
			filter: `(userPrincipalName=${username})`,
			scope: 'sub',
			attributes: Api._attrs_desired,
		};
		console.log("Performing search!");
		console.log(`Error? : ${this.error}`);
		let result = await util._search(client, opts);
		console.log(`Got back ${result.attributes}`);

		let attrs: Api.LdapAttribute[] = result.attributes;
		let info = util._marshall(attrs);
		return info;
	}
}

/**
 * @class session_class
 * Functions related to cookies and session management
 */
export class session_class {
	/**
	 * @remarks
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
	 * Calling this function implies the `username` is authenticated!
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
	 * @remarks Validates the JWT presented by the client
	 * Scaling: This function will be called quite a lot of times.
	 * Potentially switch to Elliptic-Curve keys for more security
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
export { ldap, session };
