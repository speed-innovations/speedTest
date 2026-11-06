// Shared between the server-side authorize() and the client login page, so it
// must not import anything server-only.
//
// NextAuth v4 forwards an Error thrown from authorize() to signIn() as
// `res.error = error.message`; a plain `null` arrives as 'CredentialsSignin'.
// This code is how the login page tells "we could not check" apart from
// "the password is wrong".
export const LOGIN_UNAVAILABLE = 'LoginUnavailable'
