const {
	env: {
		MGP_ZH_BOTUSERNAME,
		MGP_ZH_BOTPASSWORD,
		MGP_CM_BOTUSERNAME,
		MGP_CM_BOTPASSWORD,
        MGP_SSOUSERID,
        MGP_SSOTOKEN,
	},
} = process;
module.exports = {
	zh: {
		url: "https://zh.moegirl.org.cn/api.php",
		botUsername: MGP_ZH_BOTUSERNAME,
		botPassword: MGP_ZH_BOTPASSWORD,
		cookie: {
			moegirlSSOUserID: MGP_SSOUSERID,
			moegirlSSOToken: MGP_SSOTOKEN,
		},
	},
	mzh: {
		url: "https://mzh.moegirl.org.cn/api.php",
		botUsername: MGP_ZH_BOTUSERNAME,
		botPassword: MGP_ZH_BOTPASSWORD,
		cookie: {
			moegirlSSOUserID: MGP_SSOUSERID,
			moegirlSSOToken: MGP_SSOTOKEN,
		},
	},
	cm: {
		url: "https://commons.moegirl.org.cn/api.php",
		botUsername: MGP_CM_BOTUSERNAME,
		botPassword: MGP_CM_BOTPASSWORD,
		cookie: {
			moegirlSSOUserID: MGP_SSOUSERID,
			moegirlSSOToken: MGP_SSOTOKEN,
		},
	},
};